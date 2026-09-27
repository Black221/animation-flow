// Creating with the AI: the idea box with all its options, on a page of its own.
import { AiPrompt } from '../components/Create';
import { Icon } from '../components/Icon';

const STEPS: [string, string][] = [['Storyboard', 'les scènes, les répliques, ce qu’il faut dessiner'], ['Dessins', 'chaque personnage, accessoire et décor, relu en image'], ['Musique', 'une partition et des bruitages faits pour le film'], ['Animation', 'chaque scène, avec caméra, poses et expressions']];

export function CreatePage() {
  return (
    <div className="page create-page">
      <section className="hero" aria-label="créer avec l'IA">
        <h2>Créer avec l'<span className="grad">IA</span></h2>
        <p className="lead">Décrivez votre idée ou collez un texte, choisissez le ton, le public, les voix, la musique : l'IA fait le reste, et vous gardez la main à chaque étape.</p>
        <AiPrompt full autoFocus />
      </section>
      <ol className="how" aria-label="ce qui se passe ensuite">
        {STEPS.map(([t, d], i) => <li key={t}><span className="n">{i + 1}</span><strong>{t}</strong><span className="muted small">{d}</span></li>)}
      </ol>
      <p className="muted small centered"><Icon name="info" size={14} /> Il faut un modèle de texte dans Fournisseurs (vos propres clés : Anthropic, OpenAI, Google, Mistral…).</p>
    </div>
  );
}
