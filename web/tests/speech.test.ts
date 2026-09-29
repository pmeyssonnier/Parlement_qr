import assert from "node:assert/strict";
import test from "node:test";
import { MAX_QUESTION_LENGTH } from "../src/lib/limits";
import {
  appendTranscript,
  dictationError,
  dictationLanguage,
  recognitionConstructor,
  transcriptOf,
} from "../src/lib/speech";

const heard = (...words: string[]) => words.map(transcript => [{ transcript }]);

test("la dictée s'ajoute au texte déjà écrit, sans le remplacer", () => {
  assert.equal(appendTranscript("", "quel est l'état du projet"), "Quel est l'état du projet");
  assert.equal(appendTranscript("Logements vides ", "  et   la  mobilité "), "Logements vides et la mobilité");
  assert.equal(appendTranscript("déjà écrit", ""), "déjà écrit");
  assert.equal(appendTranscript("déjà écrit", "   "), "déjà écrit");
});

test("la dictée respecte la limite de la question", () => {
  const long = appendTranscript("a".repeat(MAX_QUESTION_LENGTH - 5), "bonjour tout le monde");
  assert.equal(long.length, MAX_QUESTION_LENGTH);
  assert.equal(appendTranscript("", "b".repeat(MAX_QUESTION_LENGTH + 50)).length, MAX_QUESTION_LENGTH);
});

test("les résultats provisoires et finaux se concatènent", () => {
  assert.equal(transcriptOf(heard("le tram", " 55")), "le tram 55");
  assert.equal(transcriptOf([]), "");
  assert.equal(transcriptOf([[]]), "");
});

test("langue de dictée : néerlandais pour un navigateur néerlandophone, sinon français belge", () => {
  assert.equal(dictationLanguage("nl-BE"), "nl-BE");
  assert.equal(dictationLanguage("nl"), "nl-BE");
  assert.equal(dictationLanguage("fr-FR"), "fr-BE");
  assert.equal(dictationLanguage("en-US"), "fr-BE");
  assert.equal(dictationLanguage(undefined), "fr-BE");
});

test("moteur de reconnaissance : celui du navigateur, ou aucun", () => {
  class Fake {}
  assert.equal(recognitionConstructor({}), null);
  assert.equal(recognitionConstructor({ webkitSpeechRecognition: Fake }), Fake);
  assert.equal(recognitionConstructor({ SpeechRecognition: Fake, webkitSpeechRecognition: class {} }), Fake);
  // Node has no speech recognition: no button on the server.
  assert.equal(recognitionConstructor(), null);
});

test("chaque échec de la dictée a un message utile, sauf l'arrêt volontaire", () => {
  for (const code of ["not-allowed", "service-not-allowed", "no-speech", "audio-capture", "network", "start-failed"])
    assert.ok(dictationError(code).length > 20, code);
  assert.match(dictationError("not-allowed"), /micro/);
  assert.equal(dictationError("aborted"), "");
});
