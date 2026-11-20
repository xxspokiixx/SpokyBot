// A reply that promises work must be recognised, whatever language the person writes in: the nudge
// is what turns "voy a revisarlo" into the tool call the person asked for. A reply the detector
// misses ends the turn with the bot having announced a task it never started.
import { describe, expect, it } from "vitest";

import { announcesAction } from "./openai-chat.ts";

describe("a reply that announces work", () => {
  it("recognises the promise in English", () => {
    for (const reply of [
      "I'll check the GitHub repo now.",
      "Let me look into that.",
      "I will search for the available models.",
      "Checking the files now.",
      "I'm going to run that command.",
      "Now I'll open the browser.",
    ]) {
      expect(announcesAction(reply), reply).toBe(true);
    }
  });

  it("recognises the promise in Spanish, which is what this person writes in", () => {
    for (const reply of [
      "Voy a revisar el repositorio ahora.",
      "Voy a buscar los modelos disponibles.",
      "Déjame verificar eso.",
      "Ahora voy a abrir el navegador.",
      "Revisando los archivos.",
      "Ejecutando el comando.",
      "Procedo a revisar el proyecto.",
      "Entendido, lo haré ahora.",
      "Lo reviso enseguida.",
      "Primero voy a inspeccionar el estado.",
    ]) {
      expect(announcesAction(reply), reply).toBe(true);
    }
  });

  it("recognises it in a long reply whose last paragraph is the promise", () => {
    const reply = "Here is what I understand about your setup.\n\nIt has a Debian desktop and a VPS.\n\nVoy a revisar el repositorio ahora.";
    expect(announcesAction(reply)).toBe(true);
  });

  it("leaves a finished answer alone, so a done turn is not nudged", () => {
    for (const reply of [
      "Done. The tests pass.",
      "I found three free models: A, B and C.",
      "Listo, la tarea está terminada.",
      "Encontré tres modelos gratuitos.",
      "",
    ]) {
      expect(announcesAction(reply), reply).toBe(false);
    }
  });

  it("leaves a question alone: asking is not announcing", () => {
    for (const reply of ["Should I continue?", "¿Quieres que lo revise?", "I'll check — which repo?"]) {
      expect(announcesAction(reply), reply).toBe(false);
    }
  });
});
