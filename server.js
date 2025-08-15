import dotenv from "dotenv";
dotenv.config();
import express from "express";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse";
import { Document, Packer, Paragraph } from "docx";
import OpenAI from "openai";
import path from "path";

const app = express();
const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Serve frontend files
app.use(express.static("public"));
app.use(express.json());

// 📌 Route to analyze uploaded resume
app.post("/api/analyze", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }

    let resumeText = "";

    // If PDF, extract text
    if (req.file.mimetype === "application/pdf") {
      const dataBuffer = fs.readFileSync(req.file.path);
      const parsed = await pdfParse(dataBuffer);
      resumeText = parsed.text;
    }
    // If TXT
    else if (req.file.mimetype === "text/plain") {
      resumeText = fs.readFileSync(req.file.path, "utf8");
    }
    // If DOCX (optional: needs extra parser)
    else {
      return res.status(400).json({ ok: false, error: "Only PDF/TXT supported for now" });
    }

    // ✅ Call OpenAI with strict scoring rules
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are an expert HR recruiter and resume evaluator." },
        { role: "user", content: `
          You will receive a candidate's resume text and the target occupation.
          Compare the resume to the skills, experience, and keywords typically required for that occupation.

          STRICT SCORING RUBRIC:
          - 90-100: Resume perfectly matches occupation with strong, measurable achievements.
          - 75-89: Resume is good but missing 1-2 key skills or measurable results.
          - 50-74: Resume shows some relevant experience but lacks multiple important requirements.
          - 25-49: Resume has little relevant experience or skills for the occupation.
          - 0-24: Resume is unrelated to the occupation.

          Respond ONLY in valid JSON format:
          {
            "score": number, // integer 0-100
            "summary": string,
            "strengths": string[],
            "weaknesses": string[],
            "missing_keywords": string[],
            "rewrite_suggestions": [
              {
                "issue": string,
                "original": string,
                "improved": string
              }
            ]
          }

          Occupation: ${req.body.occupation}
          Resume:
          ${resumeText}
        `}
      ]
    });

    const parsedAnalysis = JSON.parse(gptResponse.choices[0].message.content);

    res.json({
      ok: true,
      score: parsedAnalysis.score,
      analysis: {
        summary: parsedAnalysis.summary,
        strengths: parsedAnalysis.strengths,
        weaknesses: parsedAnalysis.weaknesses,
        missing_keywords: parsedAnalysis.missing_keywords,
        rewrite_suggestions: parsedAnalysis.rewrite_suggestions
      },
      updatedResumeText: resumeText,
      suggestedFilename: "Improved_Resume"
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 📌 Route to download improved resume
app.post("/api/download", async (req, res) => {
  const { updatedText, filename } = req.body;
  if (!updatedText) {
    return res.status(400).json({ error: "No text provided" });
  }

  const doc = new Document({
    sections: [{ children: [new Paragraph(updatedText)] }]
  });

  const buffer = await Packer.toBuffer(doc);

  res.setHeader("Content-Disposition", `attachment; filename="${filename || "Improved_Resume"}.docx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.send(buffer);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
