// Renders SVGs to exact pixel sizes. Usage: node export.cjs <dir> name:width:height[:transparent] ...
const { chromium } = require("playwright"); const fs = require("fs");
(async () => {
  const dir = process.argv[2]; const b = await chromium.launch(); const p = await b.newPage();
  for (const spec of process.argv.slice(3)) {
    const [name, w, h, t, out] = spec.split(":");
    const svg = fs.readFileSync(`${dir}/${name}.svg`, "utf8").replace(/<\?xml[^>]*>/, "").replace("<svg ", `<svg width="${w}" height="${h}" `);
    await p.setViewportSize({ width: +w, height: +h });
    await p.setContent(`<html><body style="margin:0;background:${t ? "transparent" : "#fff"}">${svg}</body></html>`);
    await p.screenshot({ path: `${dir}/${out || name + "-" + w}.png`, omitBackground: !!t });
  }
  await b.close();
})();
