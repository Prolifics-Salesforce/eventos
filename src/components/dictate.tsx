"use client";

import { useRef, useState } from "react";

type Recogniser = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

/**
 * Speak a note instead of typing it. Uses the browser's own speech recognition,
 * so what is said goes to the browser's speech service and nowhere else of ours.
 * Shown only where the browser offers it.
 */
export function Dictate({ field }: { field: string }) {
  const [on, setOn] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const recogniser = useRef<Recogniser | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (on) return recogniser.current?.stop();
    const Maker = (window as unknown as Record<string, new () => Recogniser>).SpeechRecognition ?? (window as unknown as Record<string, new () => Recogniser>).webkitSpeechRecognition;
    const target = button.current?.form?.elements.namedItem(field) as HTMLTextAreaElement | null;
    if (!Maker || !target) return setUnsupported(true);
    const r = new Maker();
    r.lang = navigator.language || "en-IN";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) target.value = `${target.value}${target.value && !/\s$/.test(target.value) ? " " : ""}${e.results[i][0].transcript.trim()}`;
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    recogniser.current = r;
    r.start();
    setOn(true);
  };

  if (unsupported) return <span className="small faint">Dictation is not available in this browser.</span>;
  return <button ref={button} type="button" className={on ? "amber" : "ghost"} onClick={toggle}>{on ? "Listening… tap to stop" : "Dictate the note"}</button>;
}
