import { el, $ } from '../util.js';
import { renderAIMaker } from './aimaker.js';
import { renderEditor, importFile, editorStop } from './editor.js';
import { webCodecsAvailable } from './engine.js';

let tab = 'ai';
export async function renderStudio(sub) {
  if (sub === 'editor' || sub === 'ai') tab = sub;
  const root = $('#view-video'); root.innerHTML = '';
  const body = el('div', { id: 'studioBody' });
  root.append(el('div', { class: 'page wide' },
    el('div', { class: 'row space wrap' }, el('h1', {}, '🎬 Video Studio'),
      el('div', { class: 'seg', id: 'studioTabs' },
        el('button', { class: tab === 'ai' ? 'on' : '', onclick: () => { location.hash = '#/video/ai'; } }, '✨ AI Video Maker'),
        el('button', { class: tab === 'editor' ? 'on' : '', onclick: () => { location.hash = '#/video/editor'; } }, '✂️ Video Editor'))),
    !webCodecsAvailable() ? el('div', { class: 'note' }, 'ℹ️ This browser has no fast video encoder (WebCodecs), so exports will be recorded in real time. Chrome or Edge is fastest.') : null,
    body));
  if (tab === 'ai') await renderAIMaker(body, { onOpenInEditor: async (file) => { location.hash = '#/video/editor'; await importFile(file); } });
  else await renderEditor(body);
}
export function leaveStudio() { editorStop(); }
