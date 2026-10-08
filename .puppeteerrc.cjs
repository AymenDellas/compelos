// Vercel hosts the dashboard; persistent workers install their own browser.
module.exports = { skipDownload: Boolean(process.env.VERCEL) };
