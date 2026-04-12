import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    // Solo permitimos peticiones POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Vercel lee la clave de forma segura desde las variables de entorno
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Extraemos el prompt que nos envía el frontend
        const { prompt } = req.body;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Devolvemos el texto generado al frontend
        res.status(200).json({ summary: text });
        
    } catch (error) {
        console.error("Error en la API:", error);
        res.status(500).json({ error: 'Fallo al generar el resumen' });
    }
}