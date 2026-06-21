type Tone = {
  frequency: number;
  start?: number;
  duration: number;
  volume?: number;
};

let sharedAudioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") {
    return null;
  }

  const WebAudioContext =
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!WebAudioContext) {
    return null;
  }

  sharedAudioContext ??= new WebAudioContext();
  return sharedAudioContext;
}

export async function unlockAudio() {
  const audioContext = getAudioContext();

  if (audioContext?.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }

  return audioContext?.state === "running";
}

export async function playToneSequence(tones: Tone[]) {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }

  if (audioContext.state !== "running") {
    return;
  }

  const baseTime = audioContext.currentTime;

  tones.forEach((tone) => {
    const startAt = baseTime + (tone.start ?? 0);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone.frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(tone.volume ?? 0.07, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.03);
  });
}

export function playMessageNotificationSound() {
  return playToneSequence([
    { frequency: 880, duration: 0.09, volume: 0.045 },
    { frequency: 1175, start: 0.1, duration: 0.12, volume: 0.04 }
  ]);
}
