# BibleGo help text blind review

A static page where reviewers compare two help texts for a verse, A and B in random order, and vote for the better one with an optional reason.

- Hosted on GitHub Pages. Votes are stored in Supabase.
- Reviewers sign in by email link or Google. The database allows one vote per person per verse, and voting again replaces the earlier vote.
- Set `supabaseUrl` and `supabaseAnonKey` in `config.js`. Run `schema.sql` once in the Supabase SQL editor.
- Without a configured database the page runs in demo mode and keeps votes only in the browser.
