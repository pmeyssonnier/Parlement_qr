import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendTranscript,
  dictationError,
  dictationLanguage,
  type Recognition,
  recognitionConstructor,
  transcriptOf,
} from "@/lib/speech";

/**
 * Dictation into the question box: what is heard replaces the words dictated
 * so far, after the text already typed. Nothing is sent by itself: the person
 * reads, corrects, then sends.
 */
export function useDictation(text: string, onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  // The recognition in progress: events of a stopped one are ignored.
  const active = useRef<Recognition | null>(null);
  const typed = useRef("");
  const latest = useRef({ text, onText });
  useEffect(() => {
    latest.current = { text, onText };
  });
  // Decided after mounting: the server cannot know the browser.
  useEffect(() => setSupported(recognitionConstructor() !== null), []);

  const cancel = useCallback(() => {
    const recognition = active.current;
    active.current = null;
    setListening(false);
    recognition?.abort();
  }, []);
  useEffect(() => cancel, [cancel]);

  const start = useCallback(() => {
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = dictationLanguage(navigator.language);
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    typed.current = latest.current.text;
    recognition.onresult = event => {
      if (active.current === recognition)
        latest.current.onText(appendTranscript(typed.current, transcriptOf(event.results)));
    };
    recognition.onerror = event => {
      if (active.current === recognition) setMessage(dictationError(event.error));
    };
    recognition.onend = () => {
      if (active.current !== recognition) return;
      active.current = null;
      setListening(false);
    };
    active.current = recognition;
    setMessage("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      active.current = null;
      setMessage(dictationError("start-failed"));
    }
  }, []);

  const toggle = useCallback(() => {
    if (active.current) active.current.stop();
    else start();
  }, [start]);

  return { supported, listening, message, toggle, cancel };
}
