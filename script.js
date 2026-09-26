"use strict";

const API_BASE = "https://equran.id/api/v2";
const TANWIN_MARKS = new Set(["ً", "ٌ", "ٍ"]);
const IZHAAR_LETTERS = new Set(["ء", "أ", "إ", "آ", "ؤ", "ئ", "ه", "ع", "ح", "غ", "خ"]);
const IDGHAM_LETTERS = new Set(Array.from("يرملون"));
const IKHFA_LETTERS = new Set(Array.from("تثجدذزسشصضطظفقك"));
const PAUSE_MARKS = new Set(["ۚ", "ۛ", "ۖ", "ۗ", "ۘ", "ۙ", "ۜ"]);
const TAJWEED_RULES = [
  { name: "izhar", label: "Izhar" },
  { name: "idgham", label: "Idgham" },
  { name: "iqlab", label: "Iqlab" },
  { name: "ikhfa", label: "Ikhfa" }
];
const ARABIC_SCRIPT_PATTERN = /\p{Script=Arabic}/u;
const LETTER_PATTERN = /\p{Letter}/u;
const elements = {
  navTabs: document.querySelectorAll(".nav-tab"),
  views: {
    quran: document.querySelector("#quran-view"),
    mentor: document.querySelector("#mentor-view"),
    ibadah: document.querySelector("#ibadah-view")
  },
  surahList: document.querySelector("#surah-list"),
  surahStatus: document.querySelector("#surah-status"),
  surahCount: document.querySelector("#surah-count"),
  surahSearch: document.querySelector("#surah-search"),
  readingState: document.querySelector("#reading-state"),
  surahContent: document.querySelector("#surah-content"),
  modeButtons: document.querySelectorAll(".mode-button"),
  scoreValue: document.querySelector("#score-value"),
  quizContext: document.querySelector("#quiz-context"),
  questionArea: document.querySelector("#question-area"),
  answerFeedback: document.querySelector("#answer-feedback"),
  nextQuestion: document.querySelector("#next-question"),
  restartQuiz: document.querySelector("#restart-quiz"),
  selectedSurah: document.querySelector("#selected-surah"),
  qiblaButton: document.querySelector("#enable-qibla"),
  qiblaBearing: document.querySelector("#qibla-bearing"),
  qiblaIndicator: document.querySelector("#qibla-indicator"),
  qiblaStatus: document.querySelector("#qibla-status"),
  dhikrList: document.querySelector("#dhikr-list")
};

const state = {
  surahs: [],
  selectedSurah: null,
  currentMode: "guess",
  currentQuestion: null,
  score: 0,
  answered: false,
  detailRequest: 0,
  activeSpeech: null,
  activeSpeechButton: null,
  qiblaBearing: null,
  deviceHeading: null,
  orientationListening: false
};

const KAABA_LATITUDE = 21.422487;
const KAABA_LONGITUDE = 39.826206;

function setView(viewName) {
  if (viewName !== "quran") stopAyahSpeech();
  Object.entries(elements.views).forEach(([name, view]) => {
    const isActive = name === viewName;
    view.hidden = !isActive;
    view.classList.toggle("is-visible", isActive);
  });
  elements.navTabs.forEach((tab) => {
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle("is-active", isActive);
    if (isActive) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
}

function calculateQiblaBearing(latitude, longitude) {
  if (latitude === KAABA_LATITUDE && longitude === KAABA_LONGITUDE) return 0;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeRadians = toRadians(latitude);
  const kaabaLatitudeRadians = toRadians(KAABA_LATITUDE);
  const longitudeDifference = toRadians(KAABA_LONGITUDE - longitude);
  const y = Math.sin(longitudeDifference);
  const x = Math.cos(latitudeRadians) * Math.tan(kaabaLatitudeRadians) -
    Math.sin(latitudeRadians) * Math.cos(longitudeDifference);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function updateQiblaIndicator() {
  if (state.qiblaBearing === null) return;
  const heading = state.deviceHeading ?? 0;
  const relativeBearing = (state.qiblaBearing - heading + 360) % 360;
  elements.qiblaIndicator.style.setProperty("--needle-angle", `${relativeBearing}deg`);
  elements.qiblaIndicator.setAttribute("aria-label", `Arah kiblat ${Math.round(state.qiblaBearing)} derajat dari utara`);
}

function handleDeviceOrientation(event) {
  const hasCompassHeading = Number.isFinite(event.webkitCompassHeading);
  const hasAbsoluteAlpha = event.absolute === true && Number.isFinite(event.alpha);
  if (!hasCompassHeading && !hasAbsoluteAlpha) return;

  const heading = hasCompassHeading ? event.webkitCompassHeading : 360 - event.alpha;
  state.deviceHeading = (heading + 360) % 360;
  updateQiblaIndicator();
  elements.qiblaStatus.textContent = "Kompas aktif. Panah mengikuti arah kiblat saat perangkat diputar.";
}

async function requestDeviceCompass() {
  if (!("DeviceOrientationEvent" in window)) return false;
  const orientationAPI = window.DeviceOrientationEvent;
  if (typeof orientationAPI.requestPermission === "function") {
    const permission = await orientationAPI.requestPermission();
    if (permission !== "granted") return false;
  }
  if (!state.orientationListening) {
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    state.orientationListening = true;
  }
  return true;
}

function getLocationErrorMessage(error) {
  if (error.code === 1) return "Izin lokasi ditolak. Izinkan lokasi di browser untuk menghitung arah kiblat.";
  if (error.code === 2) return "Lokasi perangkat tidak tersedia. Periksa GPS atau koneksi, lalu coba lagi.";
  if (error.code === 3) return "Pencarian lokasi melewati batas waktu. Coba lagi di tempat dengan sinyal lebih baik.";
  return "Lokasi tidak dapat dibaca. Periksa pengaturan browser, lalu coba lagi.";
}

async function activateQiblaCompass() {
  elements.qiblaButton.disabled = true;
  elements.qiblaStatus.textContent = "Meminta izin kompas dan lokasi…";

  let compassAvailable = false;
  try {
    compassAvailable = await requestDeviceCompass();
  } catch (error) {
    console.warn("Sensor kompas tidak diizinkan:", error);
  }

  if (!navigator.geolocation) {
    elements.qiblaStatus.textContent = "Browser ini tidak menyediakan akses lokasi. Coba gunakan browser lain.";
    elements.qiblaButton.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    state.qiblaBearing = calculateQiblaBearing(position.coords.latitude, position.coords.longitude);
    elements.qiblaBearing.textContent = `${Math.round(state.qiblaBearing)}°`;
    updateQiblaIndicator();
    if (state.deviceHeading !== null) {
      elements.qiblaStatus.textContent = "Kompas aktif. Panah mengikuti arah kiblat saat perangkat diputar.";
    } else if (compassAvailable) {
      elements.qiblaStatus.textContent = "Bearing dihitung dari lokasi. Sensor arah belum mengirim data; panah mengacu ke utara.";
    } else {
      elements.qiblaStatus.textContent = "Bearing dihitung dari lokasi. Panah mengacu ke utara karena sensor kompas tidak tersedia.";
    }
    elements.qiblaButton.disabled = false;
    elements.qiblaButton.textContent = "Perbarui arah";
  }, (error) => {
    elements.qiblaStatus.textContent = getLocationErrorMessage(error);
    elements.qiblaButton.disabled = false;
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
}

function handleDhikrAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = button.closest(".dhikr-item");
  const target = Number(item.dataset.target);
  let count = Number(item.dataset.count);

  if (button.dataset.action === "increment" && count < target) count += 1;
  if (button.dataset.action === "reset") count = 0;

  item.dataset.count = count;
  item.classList.toggle("is-complete", count === target);
  item.querySelector(".dhikr-count").innerHTML = `${count} <span>/ ${target}</span>`;
  item.querySelector('[data-action="increment"]').disabled = count === target;
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`Permintaan gagal (${response.status}).`);
  const payload = await response.json();
  if (payload.code !== 200 || payload.data == null) {
    throw new Error(payload.message || "Respons API tidak berisi data.");
  }
  return payload.data;
}

async function loadSurahs() {
  elements.surahStatus.textContent = "Memuat daftar surat…";
  elements.surahList.replaceChildren();
  elements.surahCount.textContent = "Memuat…";

  try {
    const surahs = await fetchJson("/surat");
    if (!Array.isArray(surahs)) throw new Error("Format daftar surat tidak dikenali.");
    state.surahs = surahs;
    elements.surahCount.textContent = `${surahs.length} surat`;
    elements.surahStatus.textContent = "";
    renderSurahList();
  } catch (error) {
    elements.surahCount.textContent = "Belum tersedia";
    elements.surahStatus.textContent = "Daftar surat gagal dimuat. Periksa koneksi internet lalu coba lagi.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry-button";
    retry.textContent = "Coba lagi";
    retry.addEventListener("click", loadSurahs);
    elements.surahStatus.append(" ", retry);
    console.error("Gagal memuat daftar surat:", error);
  }
}

function renderSurahList() {
  const searchTerm = elements.surahSearch.value.trim().toLocaleLowerCase("id");
  const matches = state.surahs.filter((surah) =>
    `${surah.namaLatin} ${surah.arti} ${surah.nomor}`.toLocaleLowerCase("id").includes(searchTerm)
  );
  elements.surahList.replaceChildren();

  if (matches.length === 0) {
    elements.surahStatus.textContent = "Surat tidak ditemukan.";
    return;
  }
  elements.surahStatus.textContent = "";

  matches.forEach((surah) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "surah-option";
    button.classList.toggle("is-selected", state.selectedSurah?.nomor === surah.nomor);
    button.setAttribute("aria-pressed", String(state.selectedSurah?.nomor === surah.nomor));

    const number = document.createElement("span");
    number.className = "surah-number";
    number.textContent = surah.nomor;
    const name = document.createElement("span");
    name.className = "surah-name";
    const latin = document.createElement("strong");
    latin.textContent = surah.namaLatin;
    const meaning = document.createElement("small");
    meaning.textContent = `${surah.arti} · ${surah.jumlahAyat} ayat`;
    name.append(latin, meaning);
    const arabic = document.createElement("span");
    arabic.className = "surah-arabic";
    arabic.lang = "ar";
    arabic.dir = "rtl";
    arabic.textContent = surah.nama;
    button.append(number, name, arabic);
    button.addEventListener("click", () => loadSurah(surah.nomor));
    elements.surahList.append(button);
  });
}

function setReadingStatus(message) {
  elements.surahContent.replaceChildren();
  elements.readingState.hidden = false;
  elements.readingState.replaceChildren();
  const text = document.createElement("p");
  text.className = "load-error";
  text.textContent = message;
  elements.readingState.append(text);
}

async function loadSurah(number) {
  stopAyahSpeech();
  const requestId = ++state.detailRequest;
  const listItem = state.surahs.find((surah) => surah.nomor === number);
  elements.readingState.hidden = false;
  elements.readingState.textContent = "Memuat surat dan ayat…";
  elements.surahContent.replaceChildren();
  elements.surahStatus.textContent = "";

  try {
    const surah = await fetchJson(`/surat/${number}`);
    if (requestId !== state.detailRequest) return;
    if (!Array.isArray(surah.ayat)) throw new Error("Data ayat surat tidak tersedia.");
    state.selectedSurah = surah;
    renderSurahList();
    renderSurah(surah);
    updateSelectedSurah(surah);
    if (listItem) elements.quizContext.textContent = `${surah.namaLatin} · ${surah.ayat.length} ayat`;
    startQuestion();
  } catch (error) {
    if (requestId !== state.detailRequest) return;
    setReadingStatus("Surat gagal dimuat. Periksa koneksi internet lalu pilih surat untuk mencoba lagi.");
    console.error(`Gagal memuat surat ${number}:`, error);
  }
}

function isArabicLetter(character) {
  return ARABIC_SCRIPT_PATTERN.test(character) && LETTER_PATTERN.test(character);
}

function isArabicMark(character) {
  const codePoint = character.codePointAt(0);
  return (codePoint >= 0x064b && codePoint <= 0x065f) ||
    codePoint === 0x0670 ||
    (codePoint >= 0x06d6 && codePoint <= 0x06ed);
}

function findNextArabicLetter(characters, startIndex) {
  for (let index = startIndex; index < characters.length; index += 1) {
    if (isArabicLetter(characters[index])) return index;
  }
  return -1;
}

function findNextWordLetter(characters, startIndex) {
  let passedSourceWord = false;
  for (let index = startIndex; index < characters.length; index += 1) {
    const character = characters[index];
    if (/\s/u.test(character) || PAUSE_MARKS.has(character)) {
      passedSourceWord = true;
    } else if (isArabicLetter(character) && passedSourceWord) {
      return index;
    }
  }
  return -1;
}

function findPreviousArabicLetter(characters, startIndex) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (isArabicLetter(characters[index])) return index;
  }
  return -1;
}

function classifyTajweedRule(sourceLetter, nextLetter) {
  if (sourceLetter === "م") {
    if (nextLetter === "م") return "idgham";
    if (nextLetter === "ب") return "ikhfa";
    return "izhar";
  }
  if (nextLetter === "ب") return "iqlab";
  if (IZHAAR_LETTERS.has(nextLetter)) return "izhar";
  if (IDGHAM_LETTERS.has(nextLetter)) return "idgham";
  if (IKHFA_LETTERS.has(nextLetter)) return "ikhfa";
  return null;
}

function getTajweedHighlights(text) {
  const characters = Array.from(text);
  const sourceRules = new Array(characters.length).fill(null);
  const targetRules = new Array(characters.length).fill(null);
  const markRange = (rules, start, end, rule) => {
    for (let index = start; index < end; index += 1) rules[index] = rule;
  };
  const markRule = (sourceStart, sourceEnd, targetStart, rule) => {
    let targetEnd = targetStart + 1;
    while (targetEnd < characters.length && isArabicMark(characters[targetEnd])) targetEnd += 1;
    markRange(sourceRules, sourceStart, sourceEnd, rule);
    markRange(targetRules, targetStart, targetEnd, rule);
  };

  characters.forEach((character, index) => {
    if (character === "ن" || character === "م") {
      const nextIndex = findNextArabicLetter(characters, index + 1);
      if (nextIndex < 0 || !characters.slice(index + 1, nextIndex).includes("ْ")) return;
      const rule = classifyTajweedRule(character, characters[nextIndex]);
      if (!rule) return;
      let sourceEnd = index + 1;
      while (sourceEnd < nextIndex && isArabicMark(characters[sourceEnd])) sourceEnd += 1;
      markRule(index, sourceEnd, nextIndex, rule);
      return;
    }

    if (!TANWIN_MARKS.has(character)) return;
    const sourceIndex = findPreviousArabicLetter(characters, index - 1);
    const nextIndex = findNextWordLetter(characters, index + 1);
    if (sourceIndex < 0 || nextIndex < 0) return;
    const rule = classifyTajweedRule("ن", characters[nextIndex]);
    if (!rule) return;
    markRule(sourceIndex, index + 1, nextIndex, rule);
  });

  return { characters, sourceRules, targetRules };
}

function renderTajweedText(element, text) {
  const { characters, sourceRules, targetRules } = getTajweedHighlights(text);
  const fragment = document.createDocumentFragment();
  let index = 0;

  while (index < characters.length) {
    const rule = sourceRules[index] || targetRules[index];
    let end = index + 1;
    while (end < characters.length && (sourceRules[end] || targetRules[end]) === rule) end += 1;
    const segment = characters.slice(index, end).join("");
    if (!rule) {
      fragment.append(document.createTextNode(segment));
    } else {
      const markedText = document.createElement("span");
      markedText.className = `tajweed-mark tajweed-mark--${rule}`;
      markedText.textContent = segment;
      fragment.append(markedText);
    }
    index = end;
  }
  element.replaceChildren(fragment);
}

function createTajweedLegend() {
  const legend = document.createElement("div");
  legend.className = "tajweed-legend";
  legend.setAttribute("aria-label", "Legenda warna tajwid");
  const heading = document.createElement("span");
  heading.className = "tajweed-legend-heading";
  heading.textContent = "Tajwid";
  legend.append(heading);

  TAJWEED_RULES.forEach((rule) => {
    const item = document.createElement("span");
    item.className = "tajweed-legend-item";
    const swatch = document.createElement("span");
    swatch.className = `tajweed-swatch tajweed-mark--${rule.name}`;
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = rule.label;
    item.append(swatch, label);
    legend.append(item);
  });

  const note = document.createElement("span");
  note.className = "tajweed-legend-note";
  note.textContent = "Penanda untuk hukum nun/mim sukun dan tanwin.";
  legend.append(note);

  const explanations = {
    izhar: "Nun sukun/tanwin dibaca jelas sebelum ء ه ع ح غ خ. Mim sukun juga jelas, kecuali sebelum ب atau م.",
    idgham: "Nun sukun/tanwin dilebur ke ي ر م ل و ن; mim sukun dilebur ke م.",
    iqlab: "Nun sukun/tanwin berubah menjadi bunyi mim samar saat bertemu ب.",
    ikhfa: "Nun sukun/tanwin dibaca samar dengan dengung; mim sukun disamarkan sebelum ب."
  };
  const details = document.createElement("details");
  details.className = "tajweed-details";
  const summary = document.createElement("summary");
  summary.textContent = "Arti warna";
  const definitions = document.createElement("dl");
  definitions.className = "tajweed-definitions";

  TAJWEED_RULES.forEach((rule) => {
    const definition = document.createElement("div");
    definition.className = "tajweed-definition";
    const term = document.createElement("dt");
    term.className = `tajweed-definition-term tajweed-mark--${rule.name}`;
    const swatch = document.createElement("span");
    swatch.className = `tajweed-swatch tajweed-mark--${rule.name}`;
    swatch.setAttribute("aria-hidden", "true");
    term.append(swatch, document.createTextNode(rule.label));
    const description = document.createElement("dd");
    description.textContent = explanations[rule.name];
    definition.append(term, description);
    definitions.append(definition);
  });

  details.append(summary, definitions);
  legend.append(details);
  return legend;
}

function renderSurah(surah) {
  elements.readingState.hidden = true;
  const wrapper = document.createElement("div");
  const header = document.createElement("header");
  header.className = "surah-reading-header";
  const meta = document.createElement("div");
  meta.className = "reading-meta";
  const titleBlock = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = `${surah.nomor}. ${surah.namaLatin}`;
  const subtitle = document.createElement("p");
  subtitle.textContent = `${surah.arti} · ${surah.tempatTurun} · ${surah.ayat.length} ayat`;
  titleBlock.append(title, subtitle);
  meta.append(titleBlock);
  const arabicTitle = document.createElement("div");
  arabicTitle.className = "surah-arabic-title";
  arabicTitle.lang = "ar";
  arabicTitle.dir = "rtl";
  arabicTitle.textContent = surah.nama;
  header.append(meta, arabicTitle);

  const ayahList = document.createElement("div");
  ayahList.className = "ayah-list";
  const audioStatus = document.createElement("p");
  audioStatus.className = "audio-status";
  audioStatus.setAttribute("role", "status");
  audioStatus.setAttribute("aria-live", "polite");
  audioStatus.hidden = true;
  surah.ayat.forEach((ayah) => {
    const row = document.createElement("article");
    row.className = "ayah-row";
    const topline = document.createElement("div");
    topline.className = "ayah-topline";
    const ayahNumber = document.createElement("span");
    ayahNumber.className = "ayah-number";
    ayahNumber.textContent = ayah.nomorAyat;
    ayahNumber.setAttribute("aria-label", `Ayat ${ayah.nomorAyat}`);
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "ayah-play-button";
    playButton.title = `Dengarkan ayat ${ayah.nomorAyat} dengan suara sintetis Arab`;
    playButton.setAttribute("aria-label", `Dengarkan ayat ${ayah.nomorAyat}`);
    const playIcon = document.createElement("span");
    playIcon.className = "audio-button-icon";
    playIcon.setAttribute("aria-hidden", "true");
    playIcon.textContent = "▶";
    const playLabel = document.createElement("span");
    playLabel.className = "audio-button-label";
    playLabel.textContent = "Dengarkan";
    playButton.append(playIcon, playLabel);
    playButton.addEventListener("click", () => speakAyah(ayah, playButton, audioStatus));
    topline.append(ayahNumber, playButton);
    const arabic = document.createElement("p");
    arabic.className = "ayah-text";
    arabic.lang = "ar";
    arabic.dir = "rtl";
    renderTajweedText(arabic, ayah.teksArab);
    row.append(topline, arabic);
    if (ayah.teksIndonesia) {
      const translation = document.createElement("p");
      translation.className = "ayah-translation";
      translation.textContent = ayah.teksIndonesia;
      row.append(translation);
    }
    ayahList.append(row);
  });
  wrapper.append(header, createTajweedLegend(), audioStatus, ayahList);
  elements.surahContent.replaceChildren(wrapper);
}

function setAudioStatus(statusElement, message) {
  statusElement.textContent = message;
  statusElement.hidden = false;
}

function setSpeechButton(button, isSpeaking) {
  if (!button) return;
  const ayahNumber = button.closest(".ayah-row")?.querySelector(".ayah-number")?.textContent;
  const label = button.querySelector(".audio-button-label");
  const icon = button.querySelector(".audio-button-icon");
  button.classList.toggle("is-speaking", isSpeaking);
  button.setAttribute("aria-pressed", String(isSpeaking));
  button.setAttribute("aria-label", `${isSpeaking ? "Hentikan" : "Dengarkan"} ayat ${ayahNumber}`);
  button.title = `${isSpeaking ? "Hentikan" : "Dengarkan"} ayat ${ayahNumber}`;
  if (label) label.textContent = isSpeaking ? "Hentikan" : "Dengarkan";
  if (icon) icon.textContent = isSpeaking ? "■" : "▶";
}

function stopAyahSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  setSpeechButton(state.activeSpeechButton, false);
  state.activeSpeech = null;
  state.activeSpeechButton = null;
  const statusElement = elements.surahContent.querySelector(".audio-status");
  if (statusElement) {
    statusElement.textContent = "";
    statusElement.hidden = true;
  }
}

function speakAyah(ayah, button, statusElement) {
  if (state.activeSpeechButton === button) {
    stopAyahSpeech();
    return;
  }
  stopAyahSpeech();

  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setAudioStatus(statusElement, "Pembaca suara tidak didukung oleh browser ini.");
    return;
  }

  const synthesis = window.speechSynthesis;
  const arabicVoice = synthesis.getVoices().find((voice) => /^ar(?:-|$)/i.test(voice.lang));
  if (!arabicVoice) {
    setAudioStatus(statusElement, "Voice bahasa Arab belum tersedia. Tambahkan voice Arab di pengaturan perangkat atau browser, lalu coba lagi.");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(ayah.teksArab);
  utterance.voice = arabicVoice;
  utterance.lang = arabicVoice.lang;
  utterance.rate = 0.85;
  state.activeSpeech = utterance;
  state.activeSpeechButton = button;
  setSpeechButton(button, true);
  setAudioStatus(statusElement, "Suara sintetis perangkat sedang membacakan ayat. Pelafalan dan tajwid dapat berbeda dari qiraah guru.");

  utterance.onend = () => {
    if (state.activeSpeech === utterance) stopAyahSpeech();
  };
  utterance.onerror = () => {
    if (state.activeSpeech !== utterance) return;
    stopAyahSpeech();
    setAudioStatus(statusElement, "Pembacaan ayat tidak dapat diputar. Periksa voice Arab di pengaturan perangkat.");
  };
  synthesis.speak(utterance);
}

function updateSelectedSurah(surah) {
  const title = document.createElement("strong");
  title.textContent = `${surah.nomor}. ${surah.namaLatin}`;
  const detail = document.createElement("span");
  detail.textContent = `${surah.ayat.length} ayat · ${surah.tempatTurun}`;
  elements.selectedSurah.replaceChildren(title, detail);
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function buildGuessQuestion(ayahs) {
  if (ayahs.length < 4) return null;
  const correctAyah = ayahs[Math.floor(Math.random() * ayahs.length)];
  const distractors = shuffle(ayahs.filter((ayah) => ayah.nomorAyat !== correctAyah.nomorAyat)).slice(0, 2);
  const options = shuffle([correctAyah, ...distractors]).map((ayah) => ({
    value: String(ayah.nomorAyat),
    label: `Ayat ${ayah.nomorAyat}`
  }));
  return { mode: "guess", promptAyah: correctAyah, correctValue: String(correctAyah.nomorAyat), options };
}

function buildContinueQuestion(ayahs) {
  if (ayahs.length < 4) return null;
  const possibleSources = shuffle(ayahs.slice(0, -1));

  for (const sourceAyah of possibleSources) {
    const sourceIndex = ayahs.indexOf(sourceAyah);
    const correctAyah = ayahs[sourceIndex + 1];
    const correctText = correctAyah.teksArab;
    const distractors = shuffle(ayahs.filter((ayah) =>
      ayah.nomorAyat !== sourceAyah.nomorAyat &&
      ayah.nomorAyat !== correctAyah.nomorAyat &&
      ayah.teksArab !== correctText
    ));
    const uniqueDistractors = [];
    const seenTexts = new Set([correctText, sourceAyah.teksArab]);
    distractors.forEach((ayah) => {
      if (!seenTexts.has(ayah.teksArab) && uniqueDistractors.length < 2) {
        seenTexts.add(ayah.teksArab);
        uniqueDistractors.push(ayah);
      }
    });
    if (uniqueDistractors.length < 2) continue;

    const options = shuffle([correctAyah, ...uniqueDistractors]).map((ayah) => ({
      value: ayah.teksArab,
      label: ayah.teksArab
    }));
    return { mode: "continue", promptAyah: sourceAyah, correctValue: correctText, options };
  }
  return null;
}

function buildQuestion() {
  const ayahs = state.selectedSurah?.ayat;
  if (!Array.isArray(ayahs) || ayahs.length < 4) return null;
  return state.currentMode === "guess" ? buildGuessQuestion(ayahs) : buildContinueQuestion(ayahs);
}

function renderNoQuestion() {
  elements.questionArea.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-quiz";
  const symbol = document.createElement("span");
  symbol.className = "state-symbol";
  symbol.textContent = "۞";
  const heading = document.createElement("h2");
  const message = document.createElement("p");
  if (!state.selectedSurah) {
    heading.textContent = "Pilih surat terlebih dahulu";
    message.textContent = "Buka menu Al-Qur’an, lalu pilih surat. Soal akan menggunakan ayat dari surat tersebut.";
    elements.quizContext.textContent = "Belum ada surat yang dipilih.";
  } else if (state.selectedSurah.ayat.length < 4) {
    heading.textContent = "Pilih surat lain";
    message.textContent = "Surat ini memiliki kurang dari empat ayat. Pilih surat lain agar tersedia tiga opsi jawaban yang berbeda.";
    elements.quizContext.textContent = `${state.selectedSurah.namaLatin} · soal belum tersedia`;
  } else {
    heading.textContent = "Soal belum dapat dibuat";
    message.textContent = "Data ayat surat ini belum menyediakan tiga pilihan unik untuk mode ini. Coba mode lain atau pilih surat berbeda.";
    elements.quizContext.textContent = `${state.selectedSurah.namaLatin} · soal belum tersedia`;
  }
  empty.append(symbol, heading, message);
  elements.questionArea.append(empty);
  elements.nextQuestion.disabled = true;
}

function startQuestion() {
  state.currentQuestion = buildQuestion();
  state.answered = false;
  elements.answerFeedback.textContent = "";
  elements.answerFeedback.className = "answer-feedback";
  elements.nextQuestion.disabled = true;
  if (!state.currentQuestion) {
    renderNoQuestion();
    return;
  }
  renderQuestion(state.currentQuestion);
}

function renderQuestion(question) {
  elements.quizContext.textContent = `${state.selectedSurah.namaLatin} · ${question.mode === "guess" ? "Tebak Ayat" : "Sambung Ayat"}`;
  const container = document.createElement("div");
  const prompt = document.createElement("p");
  prompt.className = "question-prompt";
  prompt.textContent = question.mode === "guess" ? "Ayat berikut ini adalah ayat nomor berapa?" : "Ayat manakah yang tepat menyambung ayat ini?";
  const arabic = document.createElement("p");
  arabic.className = "question-arabic";
  arabic.lang = "ar";
  arabic.dir = "rtl";
  arabic.textContent = question.promptAyah.teksArab;
  const options = document.createElement("div");
  options.className = "option-list";
  options.setAttribute("role", "group");
  options.setAttribute("aria-label", "Pilihan jawaban");

  question.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    if (question.mode === "continue") {
      button.classList.add("arabic-option");
      button.lang = "ar";
      button.dir = "rtl";
    }
    button.textContent = option.label;
    button.dataset.value = option.value;
    button.addEventListener("click", () => answerQuestion(button));
    options.append(button);
  });
  container.append(prompt, arabic, options);
  elements.questionArea.replaceChildren(container);
}

function showConfetti() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const colors = ["#c96755", "#c58a3c", "#557f9d", "#276a68", "#ad4d58", "#98631f"];
  const questionBounds = elements.questionArea.getBoundingClientRect();
  const originX = questionBounds.left + questionBounds.width / 2;
  const originY = questionBounds.top + Math.min(220, questionBounds.height * 0.72);
  const layer = document.createElement("div");
  const pieceCount = 36;
  let remainingPieces = pieceCount;
  layer.className = "confetti-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.addEventListener("animationend", (event) => {
    if (!event.target.classList.contains("confetti-piece")) return;
    remainingPieces -= 1;
    if (remainingPieces === 0) layer.remove();
  });

  for (let index = 0; index < pieceCount; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    piece.style.backgroundColor = colors[index % colors.length];
    piece.style.setProperty("--confetti-drift", `${(Math.random() - 0.5) * 360}px`);
    piece.style.setProperty("--confetti-rise", `${-(140 + Math.random() * 270)}px`);
    piece.style.setProperty("--confetti-rotation", `${Math.round((Math.random() - 0.5) * 900)}deg`);
    piece.style.setProperty("--confetti-duration", `${1.35 + Math.random() * 0.65}s`);
    piece.style.setProperty("--confetti-delay", `${Math.random() * 0.12}s`);
    piece.style.width = `${5 + Math.random() * 5}px`;
    piece.style.height = `${8 + Math.random() * 7}px`;
    layer.append(piece);
  }

  document.body.append(layer);
}

function answerQuestion(selectedButton) {
  if (state.answered || !state.currentQuestion) return;
  state.answered = true;
  const isCorrect = selectedButton.dataset.value === state.currentQuestion.correctValue;
  const buttons = elements.questionArea.querySelectorAll(".answer-option");
  buttons.forEach((button) => {
    button.disabled = true;
    if (button.dataset.value === state.currentQuestion.correctValue) button.classList.add("is-correct");
  });

  if (isCorrect) {
    state.score += 10;
    elements.scoreValue.textContent = state.score;
    elements.answerFeedback.textContent = "Benar! +10 poin";
    elements.answerFeedback.classList.add("is-correct");
    showConfetti();
  } else {
    selectedButton.classList.add("is-wrong");
    const correctOption = state.currentQuestion.options.find((option) => option.value === state.currentQuestion.correctValue);
    elements.answerFeedback.replaceChildren(document.createTextNode("✕ Belum tepat. Jawaban yang benar: "));
    const answer = document.createElement("bdi");
    answer.className = "correct-answer-text";
    answer.textContent = correctOption.label;
    if (state.currentQuestion.mode === "continue") {
      answer.lang = "ar";
      answer.dir = "rtl";
    }
    elements.answerFeedback.append(answer);
    elements.answerFeedback.classList.add("is-wrong");
  }
  elements.nextQuestion.disabled = false;
}

function restartQuiz() {
  state.score = 0;
  elements.scoreValue.textContent = "0";
  startQuestion();
}

elements.navTabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
elements.surahSearch.addEventListener("input", renderSurahList);
elements.modeButtons.forEach((button) => button.addEventListener("click", () => {
  state.currentMode = button.dataset.mode;
  elements.modeButtons.forEach((modeButton) => {
    const active = modeButton === button;
    modeButton.classList.toggle("is-active", active);
    modeButton.setAttribute("aria-pressed", String(active));
  });
  startQuestion();
}));
elements.nextQuestion.addEventListener("click", startQuestion);
elements.restartQuiz.addEventListener("click", restartQuiz);
elements.qiblaButton.addEventListener("click", activateQiblaCompass);
elements.dhikrList.addEventListener("click", handleDhikrAction);

loadSurahs();