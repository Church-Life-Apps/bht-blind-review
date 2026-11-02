(async function () {
  const cfg = window.BHT_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const verses = await (await fetch('verses.json')).json();
  const DEMO = !cfg.supabaseUrl || !cfg.supabaseAnonKey;
  const sb = DEMO ? null : window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  let user = null;
  let votes = {};            // verse_id -> {choice, reason}
  let idx = 0;

  // ---------- storage ----------
  async function loadVotes() {
    if (DEMO) { votes = JSON.parse(localStorage.getItem('bhtVotes') || '{}'); return; }
    const { data, error } = await sb.from('votes').select('verse_id, choice, reason');
    if (error) { setStatus('Could not load your votes: ' + error.message, 'err'); return; }
    votes = {};
    for (const r of data) votes[r.verse_id] = { choice: r.choice, reason: r.reason || '' };
  }
  async function saveVote(vid, choice, reason) {
    if (DEMO) {
      votes[vid] = { choice, reason };
      localStorage.setItem('bhtVotes', JSON.stringify(votes));
      return null;
    }
    // One row per person per verse. Upsert replaces an earlier vote instead of adding another.
    const { error } = await sb.from('votes')
      .upsert({ user_id: user.id, verse_id: vid, choice, reason: reason || null }, { onConflict: 'user_id,verse_id' });
    if (!error) votes[vid] = { choice, reason };
    return error;
  }

  // ---------- auth ----------
  async function initAuth() {
    if (DEMO) { $('demo').classList.remove('hidden'); return true; }
    if (new URLSearchParams(location.search).has('signout')) {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (_) {}
      Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      history.replaceState(null, '', location.pathname);
    }
    const { data } = await sb.auth.getSession();
    user = data.session && data.session.user;
    sb.auth.onAuthStateChange((_e, s) => {
      const was = !!user; user = s && s.user;
      if (!!user !== was) location.reload();
    });
    if (user) {
      $('who').textContent = 'Signed in as ' + (user.email || 'reviewer');
      $('account').classList.remove('hidden');
      $('signout').onclick = async (e) => {
        e.preventDefault();
        try { await sb.auth.signOut({ scope: 'local' }); } catch (_) {}
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
        location.href = location.pathname;
      };
      return true;
    }
    $('signin').classList.remove('hidden');
    if (cfg.googleSignIn && cfg.googleClientId) {
      // Google's own sign-in button runs on this site, so Google's prompt names this site instead of the database address.
      const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const hashed = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        nonce: hashed,
        use_fedcm_for_prompt: true,
        callback: async (resp) => {
          const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: resp.credential, nonce: raw });
          if (error) { $('signinStatus').textContent = 'Could not sign in with Google: ' + error.message; $('signinStatus').className = 'status err'; }
        },
      });
      $('google').classList.remove('hidden');
      google.accounts.id.renderButton($('google'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
    }
    $('sendLink').onclick = async () => {
      const email = $('email').value.trim();
      if (!email) return;
      $('sendLink').disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } });
      $('signinStatus').textContent = error ? 'Could not send the link: ' + error.message : 'Check your email for the sign-in link.';
      $('signinStatus').className = 'status ' + (error ? 'err' : 'ok');
      $('sendLink').disabled = false;
    };
    return false;
  }

  // ---------- UI ----------
  function setStatus(msg, kind) { $('status').textContent = msg || ''; $('status').className = 'status ' + (kind || ''); }
  function label(v) { return (votes[v.id] ? '✓ ' : '\u2003') + v.ref; }
  function fillPicker() {
    $('pick').innerHTML = verses.map((v, i) => `<option value="${i}">${label(v)}</option>`).join('');
    $('pick').value = idx;
    $('done').textContent = Object.keys(votes).filter((k) => verses.some((v) => v.id === k)).length;
    $('total').textContent = verses.length;
  }
  function show(i) {
    idx = (i + verses.length) % verses.length;
    const v = verses[idx], mine = votes[v.id];
    $('ref').textContent = v.ref;
    $('verse').textContent = v.verse;
    $('textA').textContent = v.a;
    $('textB').textContent = v.b;
    $('cardA').classList.toggle('chosen', !!mine && mine.choice === 'A');
    $('cardB').classList.toggle('chosen', !!mine && mine.choice === 'B');
    $('why').value = mine ? mine.reason || '' : '';
    $('saveWhy').disabled = !mine;
    setStatus(mine ? 'Your vote: ' + mine.choice + '. You can change it.' : '');
    fillPicker();
    history.replaceState(null, '', '#' + encodeURIComponent(v.id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.card button').forEach((b) => b.onclick = async () => {
    const v = verses[idx], choice = b.dataset.choice;
    document.querySelectorAll('.card button').forEach((x) => x.disabled = true);
    const err = await saveVote(v.id, choice, $('why').value.trim());
    document.querySelectorAll('.card button').forEach((x) => x.disabled = false);
    if (err) { setStatus('Could not save: ' + err.message, 'err'); return; }
    $('cardA').classList.toggle('chosen', choice === 'A');
    $('cardB').classList.toggle('chosen', choice === 'B');
    $('saveWhy').disabled = false;
    setStatus('Saved. You voted ' + choice + '.', 'ok');
    fillPicker();
  });
  $('saveWhy').onclick = async () => {
    const v = verses[idx], mine = votes[v.id];
    if (!mine) return;
    const err = await saveVote(v.id, mine.choice, $('why').value.trim());
    setStatus(err ? 'Could not save: ' + err.message : 'Reason saved.', err ? 'err' : 'ok');
  };
  $('pick').onchange = () => show(+$('pick').value);
  $('prev').onclick = () => show(idx - 1);
  $('next').onclick = () => show(idx + 1);
  $('nextOpen').onclick = () => {
    for (let k = 1; k <= verses.length; k++) {
      const j = (idx + k) % verses.length;
      if (!votes[verses[j].id]) return show(j);
    }
    setStatus('You have voted on every verse. Thank you!', 'ok');
  };

  // ---------- start ----------
  if (!(await initAuth())) return;
  await loadVotes();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const start = verses.findIndex((v) => v.id === fromHash);
  $('app').classList.remove('hidden');
  show(start >= 0 ? start : 0);
})();
