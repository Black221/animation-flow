// The text model chosen for a task (Réglages → Fournisseurs), bound to its decrypted key for the duration of a job.
import type { Model } from '@af/ai';
import { complete, providerById, type JsonPost } from '@af/providers';
import type { SecretBox } from '../crypto';
import type { Db } from '../db';

export class NotConfigured extends Error {}

export async function modelFor(db: Db, box: SecretBox, task: 'storyboard' | 'scenes', fetchImpl?: JsonPost): Promise<Model> {
  const { rows } = await db.query<{ model: string; provider: string | null; secret: string | null; base_url: string | null }>(
    `SELECT a.model, c.provider, c.secret, c.base_url FROM model_assignments a LEFT JOIN credentials c ON c.id = a.credential_id WHERE a.task = $1`, [task]);
  const a = rows[0], label = task === 'storyboard' ? 'Texte → storyboard' : 'Storyboard → scènes';
  if (!a?.provider) throw new NotConfigured(`aucun modèle pour « ${label} » : Réglages → Fournisseurs`);
  if (!a.model) throw new NotConfigured(`choisissez un modèle pour « ${label} » : Réglages → Fournisseurs`);
  let apiKey: string | undefined;
  try { apiKey = a.secret ? box.open(a.secret) : undefined; } catch { throw new NotConfigured('la clé ne peut pas être déchiffrée : saisissez-la de nouveau'); }
  const provider = a.provider, model = a.model, baseUrl = a.base_url ?? undefined;
  return {
    label: `${providerById(provider)?.label ?? provider} · ${model}`,
    call: (req) => complete(provider, { apiKey, baseUrl }, { ...req, model }, fetchImpl),
  };
}
