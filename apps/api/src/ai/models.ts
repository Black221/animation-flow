// The text model a workspace chose for a task (Réglages → Fournisseurs), bound to its decrypted key for a job.
import type { Model } from '@af/ai';
import { complete, generateImage, providerById, type JsonPost } from '@af/providers';
import type { SecretBox } from '../crypto';
import type { Db } from '../db';

export class NotConfigured extends Error {}

const LABEL = { storyboard: 'Texte → storyboard', scenes: 'Storyboard → scènes', assets: 'Dessins', music: 'Musique et bruitages' } as const;

/** the model of a task that may be left unset: then the scenes model does it */
async function orScenes(db: Db, box: SecretBox, ws: string, task: 'assets' | 'music', fetchImpl: JsonPost): Promise<Model> {
  try { return await modelFor(db, box, ws, task, fetchImpl); } catch (e) { if (e instanceof NotConfigured) return modelFor(db, box, ws, 'scenes', fetchImpl); throw e; }
}
/** the drawing model: the one chosen for « Dessins », else the scenes model */
export const drawingModel = (db: Db, box: SecretBox, ws: string, fetchImpl: JsonPost) => orScenes(db, box, ws, 'assets', fetchImpl);
/** the composing model: the one chosen for « Musique et bruitages », else the scenes model */
export const musicModel = (db: Db, box: SecretBox, ws: string, fetchImpl: JsonPost) => orScenes(db, box, ws, 'music', fetchImpl);

export async function modelFor(db: Db, box: SecretBox, ws: string, task: keyof typeof LABEL, fetchImpl: JsonPost): Promise<Model> {
  const { rows } = await db.query<{ model: string; provider: string | null; secret: string | null; base_url: string | null }>(
    `SELECT a.model, c.provider, c.secret, c.base_url FROM model_assignments a LEFT JOIN credentials c ON c.id = a.credential_id WHERE a.task = $1 AND a.workspace_id = $2`, [task, ws]);
  const a = rows[0], label = LABEL[task];
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

export interface ImageModel { label: string; paint(prompt: string): ReturnType<typeof generateImage> }
/** the picture model chosen for « Décors en images », or null: that task is optional (decors then stay drawings) */
export async function imageModel(db: Db, box: SecretBox, ws: string, fetchImpl: JsonPost): Promise<ImageModel | null> {
  const { rows } = await db.query<{ model: string; provider: string | null; secret: string | null; base_url: string | null }>(
    `SELECT a.model, c.provider, c.secret, c.base_url FROM model_assignments a LEFT JOIN credentials c ON c.id = a.credential_id WHERE a.task = 'images' AND a.workspace_id = $1`, [ws]);
  const a = rows[0];
  if (!a?.provider) return null;
  const p = providerById(a.provider);
  if (!p?.image) return null;
  let apiKey: string | undefined;
  try { apiKey = a.secret ? box.open(a.secret) : undefined; } catch { throw new NotConfigured('la clé des images ne peut pas être déchiffrée : saisissez-la de nouveau'); }
  const provider = a.provider, model = a.model || p.image.defaultModel, baseUrl = a.base_url ?? undefined;
  return { label: `${p.label} · ${model}`, paint: (prompt) => generateImage(provider, { apiKey, baseUrl }, { prompt, model, landscape: true }, fetchImpl) };
}
