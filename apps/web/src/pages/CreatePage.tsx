// Creating with the AI: the idea box with all its options (the tracks of a timeline), on a page of its own.
import { AiPrompt } from '../components/Create';
import { Icon } from '@af/ui';

export function CreatePage() {
  return (
    <div className="page create-page">
      <section className="hero" aria-label="créer avec l'IA">
        <h2>Créer avec l'<span className="grad">IA</span></h2>
        <p className="lead">Décrivez votre idée ou collez un texte, réglez chaque piste (durée, ton, public, voix, musique, rythme) : l'IA fait le reste, et vous gardez la main à chaque étape.</p>
        <AiPrompt full autoFocus />
      </section>
      <p className="muted small centered"><Icon name="info" size={14} /> Il faut un modèle de texte dans Fournisseurs (vos propres clés : Anthropic, OpenAI, Google, Mistral…).</p>
    </div>
  );
}
