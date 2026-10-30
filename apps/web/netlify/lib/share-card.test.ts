// Run: node --experimental-strip-types netlify/lib/share-card.test.ts
import assert from "node:assert/strict";
import { cardHtml, isPreviewBot, rand } from "./share-card.ts";

assert.equal(rand(25000), "R250");
assert.equal(rand(125000), "R1,250");
assert.ok(isPreviewBot("WhatsApp/2.23.20.0 A"));
assert.ok(isPreviewBot("facebookexternalhit/1.1"));
assert.ok(!isPreviewBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"));
const html = cardHtml({ title: `Levi's "501" <jeans>`, description: "From Lebo", image: "https://x/y.jpg", url: "https://myhaul.co.za/i/1", open: "/s/lebo?item=1" });
assert.ok(html.includes("Levi&#39;s &quot;501&quot; &lt;jeans&gt;"), "title is escaped");
assert.ok(!html.includes("<jeans>"));
assert.ok(html.includes('property="og:image" content="https://x/y.jpg"'));
console.log("share card tests passed");
