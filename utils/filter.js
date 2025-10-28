// filter.js
const wordReplacements = {
  "Keno": "KePa",
  "Jannik": "Froggy",
  "Daniel": "Sigma",
  "Sajid": "ribbiter",
  
  "du": "ribbi",
  "sie": "rib",
  "er": "rib",
  "es": "rib",
  
  "ist": "ru",
  
  "hi": "ribi",
  
  "ich": "ribbii",
  "bin": "rir",
  "bist": "riir",
  
  "ein": "croak",
  
  "zwei": "croaoak",
  "drei": "croaoaoak",
  "vier": "croaoaoaoak",
  "fünf": "croaoaoaoaoak",
  "sechs": "croaoaoaoaoaoak",
  "sieben": "croaoaoaoaoaoaoak",
  "acht": "croaoaoaoaoaoaoaoak",
  "neun": "croaoaoaoaoaoaoaoaoak",

  "Hallo": "Ribbit",
  "hallo": "ribbit",

  "Tschüss": "Plopp",
  "tschüss": "plopp",

  "Ja": "Quak",
  "ja": "quak",

  "Nein": "Krrrk",
  "nein": "krrrk",

  "Wie geht’s?": "Ribbit vibes?",
  "wie geht’s?": "ribbit vibes?",

  "Gut": "Teichklar",
  "gut": "teichklar",

  "Schlecht": "Algenalarm",
  "schlecht": "algenalarm",

  "Essen": "Mückenfang",
  "essen": "mückenfang",

  "Trinken": "Schlürfsaft",
  "trinken": "schlürfsaft",

  "Freund": "Mitquaker",
  "freund": "mitquaker",

  "Chat": "RibbitRoom",
  "chat": "ribbitroom",

  "Spiel": "Teichkampf",
  "spiel": "teichkampf",

  "Computer": "Ribbit-Box",
  "computer": "ribbit-box",

  "Handy": "Mini-Teich",
  "handy": "mini-teich",

  "Lehrer": "Großfrosch",
  "lehrer": "großfrosch",

  "Schule": "Teichschule",
  "schule": "teichschule",

  "Cool": "Froschfrisch",
  "cool": "froschfrisch",

  "Lustig": "Quaklustig",
  "lustig": "quaklustig",

  "Dumm": "Kaulquapenkram",
  "dumm": "kaulquapenkram",

  "Geheim": "Unter dem Seerosenblatt",
  "geheim": "unter dem seerosenblatt",

  "Treffen": "Teichtreff",
  "treffen": "teichtreff",

  "Schnell": "Fliegfangtempo",
  "schnell": "fliegfangtempo",

  "Langsam": "Schlammschritt",
  "langsam": "schlammschritt",

  "Warten": "Sitzen auf Seerose",
  "warten": "sitzen auf seerose",

  "Danke": "Quak dir",
  "danke": "quak dir",

  "Bitte": "Ribbit gern",
  "bitte": "ribbit gern",

  "Gut gemacht": "Meisterquak",
  "gut gemacht": "meisterquak",

  "Fehler": "Schlammspur",
  "fehler": "schlammspur",

  "Los!": "Spring!",
  "los!": "spring!",

  "Okay": "Rib-ok",
  "okay": "rib-ok"


  // hier weitere Wörter hinzufügen
};

function filterMessage(text) {
  if (!text) return text;

  Object.keys(wordReplacements).forEach(word => {
    const replacement = wordReplacements[word];
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    text = text.replace(regex, replacement);
  });

  return text;
}

module.exports = filterMessage;
