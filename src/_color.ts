// Colors support for terminal output
const noColor = /* @__PURE__ */ (() => {
  const p = globalThis.process || {};
  const argv = p.argv || [];
  const env = p.env || {};
  const supported =
    !(!!env.NO_COLOR || argv.includes("--no-color")) &&
    (!!env.FORCE_COLOR ||
      argv.includes("--color") ||
      p.platform === "win32" ||
      ((p.stdout || {}).isTTY && env.TERM !== "dumb") ||
      !!env.CI);
  return !supported;
})();

const w = (c: number, r: number = 39) => {
  return (t: string) => (noColor ? t : `\u001B[${c}m${t}\u001B[${r}m`);
};

type ColorType = (text: string) => string;

const bold: ColorType = /* @__PURE__ */ w(1, 22);
const red: ColorType = /* @__PURE__ */ w(31);
const green: ColorType = /* @__PURE__ */ w(32);
const yellow: ColorType = /* @__PURE__ */ w(33);
const blue: ColorType = /* @__PURE__ */ w(34);
const magenta: ColorType = /* @__PURE__ */ w(35);
const cyan: ColorType = /* @__PURE__ */ w(36);
const gray: ColorType = /* @__PURE__ */ w(90);

const url = (title: string, url: string): string => {
  return noColor ? `[${title}](${url})` : `\u001B]8;;${url}\u001B\\${title}\u001B]8;;\u001B\\`;
};

export default {
  bold,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  gray,
  url,
};
