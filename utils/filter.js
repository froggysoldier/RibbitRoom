// filter.js
const wordReplacements = {
  "hallo": "ribbit",
  "Keno": "KePa",
  "Jannik": "Froggy",
  "Daniel": "Sigma",
  "Sajid": "ribbiter",
  "du": "ribbi",
  "sie": "rib",
  "er": "rib",
  "ist": "ru",
  "hi": "ribi",
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
