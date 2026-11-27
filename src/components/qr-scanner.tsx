"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Reads the QR code on a guest's pass with the device's camera and submits the
 * pass number. The picture never leaves the device: each frame is read here,
 * in the browser, and only the number is sent.
 */
export function QrScanner({ action, eventId, auto }: { action: (form: FormData) => void | Promise<void>; eventId: string; auto: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const number = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"off" | "starting" | "on" | "found">("off");
  const [problem, setProblem] = useState("");

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setState("off");
  }, []);

  const start = useCallback(async () => {
    setProblem("");
    if (!navigator.mediaDevices?.getUserMedia) return setProblem("This browser cannot use the camera. Search by name instead.");
    setState("starting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setState("on");
    } catch {
      setState("off");
      setProblem("The camera could not be opened. Allow camera access for this site, or search by name instead.");
    }
  }, []);

  // Once the camera is on, look at a frame about eight times a second until a pass number is seen.
  useEffect(() => {
    if (state !== "on" || !video.current || !stream.current) return;
    const el = video.current;
    el.srcObject = stream.current;
    void el.play().catch(() => {});
    const canvas = document.createElement("canvas");
    const timer = setInterval(() => {
      if (el.readyState < 2 || !el.videoWidth) return;
      const scale = Math.min(1, 640 / el.videoWidth);
      canvas.width = Math.round(el.videoWidth * scale);
      canvas.height = Math.round(el.videoHeight * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(el, 0, 0, canvas.width, canvas.height);
      const found = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data.trim().toUpperCase();
      if (!found || !/^REG\d{1,12}$/.test(found) || !number.current || !form.current) return;
      clearInterval(timer);
      number.current.value = found;
      setState("found");
      form.current.requestSubmit();
    }, 120);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => { if (auto) void start(); }, [auto, start]);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  return (
    <div style={{ marginBottom: 12 }}>
      <form ref={form} action={action}><input type="hidden" name="eventId" value={eventId} /><input ref={number} type="hidden" name="number" /></form>
      {state === "off" ? <button type="button" className="ghost" onClick={start} style={{ width: "100%" }}>Scan a pass</button> : (
        <div>
          <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 14, background: "#000", aspectRatio: "4 / 3", objectFit: "cover", display: "block" }} />
          <div className="actions" style={{ marginTop: 8 }}>
            <span className="small muted">{state === "found" ? "Read. Checking in…" : state === "starting" ? "Opening the camera…" : "Hold the QR code on the pass in front of the camera."}</span>
            <button type="button" className="link" onClick={stop} style={{ marginLeft: "auto" }}>Stop</button>
          </div>
        </div>
      )}
      {problem && <div className="notice quiet" style={{ marginTop: 8 }}>{problem}</div>}
    </div>
  );
}
