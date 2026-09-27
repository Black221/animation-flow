import { exampleProject, type ProjectInput } from '@af/schema';
// a whole film drawn for its story (15 drawings, a score, 8 sound effects, 6 scenes), as a generation makes one
import pizzaTime from './examples/pizza-time.json';

export const blankProject = (title: string): ProjectInput => ({
  schemaVersion: 1,
  title,
  style: 'flat',
  scenes: [{
    id: 's1', title: 'Première scène', duration: 5, decor: { kind: 'plain', params: { color: '#FBF3E6' } },
    elements: [{ id: 'title', type: 'text', params: { text: title, size: 72 }, keys: [{ t: 0, x: 960, y: 540, opacity: 0 }, { t: 0.8, opacity: 1 }] }],
  }],
});

export const TEMPLATES: Record<string, (title?: string) => ProjectInput> = {
  example: (title) => ({ ...structuredClone(exampleProject), ...(title ? { title } : {}) }),
  pizza: (title) => ({ ...(structuredClone(pizzaTime) as unknown as ProjectInput), ...(title ? { title } : {}) }),
  blank: (title) => blankProject(title || 'Nouveau projet'),
};
