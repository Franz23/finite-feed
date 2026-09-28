// Capture a raw Apify dataset sample for fixtures. Usage:
//   APIFY_TOKEN=... node scripts/apify-sample.mjs <actorId> <handle1,handle2> <YYYY-MM-DD> <maxItems>
// Prints the raw items as JSON to stdout. Never prints the token.
const [actorId, handles, start, maxItems = "30"] = process.argv.slice(2);
const token = process.env.APIFY_TOKEN;
if (!token || !actorId || !handles || !start) {
  console.error("usage: APIFY_TOKEN=... node scripts/apify-sample.mjs <actorId> <handles,comma,separated> <YYYY-MM-DD> [maxItems]");
  process.exit(1);
}
const twitterHandles = handles.split(",").map((h) => h.trim()).filter(Boolean);
const input = actorId.startsWith("xquik")
  ? { twitterHandles, since: `${start}_00:00:00_UTC`, maxItems: Number(maxItems), maxItemsPerTarget: Math.ceil(Number(maxItems) / twitterHandles.length) }
  : { twitterHandles, start, maxItems: Number(maxItems), sort: "Latest" };
const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=240&clean=true`;
const response = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(input),
});
if (!response.ok) {
  console.error(`Apify returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
process.stdout.write(JSON.stringify(await response.json(), null, 2));
