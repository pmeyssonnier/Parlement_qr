// Dictation of a question with the browser's speech recognition (Web Speech
// API). Kept free of React and of the server: the transcription is done by the
// browser (or its vendor's service), Parlement QR only receives the text once
// the person sends it.
import { MAX_QUESTION_LENGTH } from "./limits";

/** The part of the Web Speech API used here (not in every TypeScript DOM library). */
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type RecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type RecognitionConstructor = new () => Recognition;

/** The browser's recognition, or null (Firefox, or outside a browser). */
export function recognitionConstructor(scope: object = globalThis): RecognitionConstructor | null {
  const w = scope as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Dutch-speaking browsers dictate in Dutch, all others in Belgian French. */
export function dictationLanguage(browserLanguage: string | undefined) {
  return /^nl\b/i.test(browserLanguage ?? "") ? "nl-BE" : "fr-BE";
}

/** Everything heard so far in this dictation, final and provisional words. */
export function transcriptOf(results: RecognitionResultEvent["results"]) {
  let text = "";
  for (let i = 0; i < results.length; i++) text += results[i]?.[0]?.transcript ?? "";
  return text;
}

/** The text already typed, then what was said, within the question limit. */
export function appendTranscript(base: string, transcript: string, max = MAX_QUESTION_LENGTH) {
  const spoken = transcript.replace(/\s+/g, " ").trim();
  if (!spoken) return base;
  const head = base.trimEnd();
  const sentence = head ? spoken : `${spoken.charAt(0).toLocaleUpperCase("fr-BE")}${spoken.slice(1)}`;
  return (head ? `${head} ${sentence}` : sentence).slice(0, max);
}

/** What to tell the person when the dictation fails (codes of the Web Speech API). */
export function dictationError(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "L’accès au micro est refusé. Autorisez-le dans les réglages du navigateur, ou écrivez votre question.";
    case "no-speech":
      return "Je n’ai rien entendu. Touchez le micro et parlez, ou écrivez votre question.";
    case "audio-capture":
      return "Aucun micro n’a été trouvé sur cet appareil.";
    case "network":
      return "La dictée demande une connexion à Internet. Écrivez votre question ou réessayez plus tard.";
    case "aborted":
      return "";
    default:
      return "La dictée n’a pas fonctionné. Vous pouvez écrire votre question.";
  }
}
