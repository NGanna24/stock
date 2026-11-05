// scripts/tester-gemini.js
// Vérifie la clé Gemini et le modèle, sans toucher à la base.
// Lancer depuis le dossier backend :  node scripts/tester-gemini.js
import dotenv from 'dotenv';
dotenv.config();

const { default: Gemini } = await import('../Services/GeminiClient.js');

const cle = process.env.GEMINI_API_KEY;
if (!cle) {
  console.log('NON : GEMINI_API_KEY absent du fichier .env');
  console.log('Crée une clé gratuite sur https://aistudio.google.com/apikey puis ajoute :');
  console.log('GEMINI_API_KEY=ta_cle');
  process.exit(1);
}

// 1. Modèles Flash accessibles avec cette clé
try {
  const rep = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': cle },
  });
  const json = await rep.json();
  if (!rep.ok) {
    console.log('NON : Google refuse la clé →', json?.error?.message);
    process.exit(1);
  }
  const flash = (json.models || [])
    .map((m) => m.name.replace('models/', ''))
    .filter((n) => /flash/.test(n) && !/image|tts|live|audio|embedding/.test(n));
  console.log('OK  clé valide. Modèles Flash disponibles :');
  console.log('    ' + flash.join(', '));
} catch (e) {
  console.log('NON : impossible de joindre Google →', e.message);
  process.exit(1);
}

// 2. Une vraie question avec un outil
try {
  const r = await Gemini.discuter({
    messages: [
      { role: 'system', content: 'Tu es Miyo, assistant de boutique. Réponds en une phrase.' },
      { role: 'user', content: "Combien de bidons d'huile il me reste ?" },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'rechercher_produit',
          description: 'Cherche un produit par son nom',
          parameters: { type: 'object', properties: { nom: { type: 'string' } }, required: ['nom'] },
        },
      },
    ],
    max_tokens: 1500,
  });
  const appel = r.choices[0].message.tool_calls?.[0];
  console.log(`OK  modèle utilisé : ${Gemini.modeleActif}`);
  console.log(
    appel
      ? `OK  Gemini appelle bien l'outil : ${appel.function.name}(${appel.function.arguments})`
      : `??  pas d'outil appelé, réponse : ${r.choices[0].message.content}`
  );
  console.log('\nTout est prêt : redémarre le serveur (pm2 restart) et parle à Miyo.');
} catch (e) {
  console.log('NON :', e.message);
  process.exit(1);
}
