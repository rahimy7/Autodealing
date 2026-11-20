// The quote figures are computed by one function (../js/quote-math.js): the server stores them
// with it and the app shows them while the salesperson types. Metro can't import from outside
// this folder, so the file is copied here; tests/mobile.test.js fails if the two ever differ.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const from = fileURLToPath(new URL("../../js/quote-math.js", import.meta.url));
const to = fileURLToPath(new URL("../src/lib/quote-math.js", import.meta.url));
copyFileSync(from, to);
console.log("quote-math.js copied");
