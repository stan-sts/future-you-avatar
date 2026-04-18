// Browser-native "avatar speaks" using the Web Speech API.
// Picks a reasonable voice per scenario and animates the image while speaking.

(function (global) {
  let voices = [];

  function loadVoices() {
    return new Promise(resolve => {
      voices = speechSynthesis.getVoices();
      if (voices.length) return resolve(voices);
      speechSynthesis.onvoiceschanged = () => {
        voices = speechSynthesis.getVoices();
        resolve(voices);
      };
    });
  }

  function pickVoice(scenario) {
    if (!voices.length) return null;
    // Prefer English voices; pick a "warmer" voice for the improve scenario.
    const english = voices.filter(v => /en(-|_)?/i.test(v.lang));
    const pool = english.length ? english : voices;
    const preferredNames = scenario === "improve"
      ? [/samantha/i, /karen/i, /google us english/i, /jenny/i]
      : [/daniel/i, /alex/i, /google uk english male/i];
    for (const re of preferredNames) {
      const hit = pool.find(v => re.test(v.name));
      if (hit) return hit;
    }
    return pool[0];
  }

  async function speak(text, scenario, imgEl) {
    await loadVoices();
    speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(scenario);
    if (voice) utter.voice = voice;
    utter.rate = scenario === "improve" ? 1.02 : 0.95;
    utter.pitch = scenario === "improve" ? 1.05 : 0.9;
    utter.volume = 1;

    if (imgEl) imgEl.classList.add("speaking");
    utter.onend = () => { if (imgEl) imgEl.classList.remove("speaking"); };
    utter.onerror = () => { if (imgEl) imgEl.classList.remove("speaking"); };

    speechSynthesis.speak(utter);
    return utter;
  }

  function stop() {
    speechSynthesis.cancel();
    document.querySelectorAll(".avatar-img.speaking")
      .forEach(el => el.classList.remove("speaking"));
  }

  global.AvatarVoice = { speak, stop };
})(window);
