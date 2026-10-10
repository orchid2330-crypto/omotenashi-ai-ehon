/*
 * おもてなしの学校 デジタル絵本
 * 文章・画像・リンク先はすべて story.json に置いています（このファイルは動きだけを担当）。
 *
 * 画面の番号：0 = 表紙、1〜10 = 物語のページ、11 = 終了画面
 */
(function () {
  'use strict';

  var STORY_URL = 'story.json';
  var PAGE_GAP_MS = 1200;      // 読み終えてから次のページへ移るまでの間
  var SEGMENT_GAP_MS = 250;    // 文と文の間
  var SILENT_MS_PER_CHAR = 170; // 音声なし自動送りで1文字あたりに取る時間
  var SILENT_MIN_MS = 1800;
  var SPEECH_START_TIMEOUT_MS = 4000;
  var COPYRIGHT = '© シーキューブ株式会社 おもてなしの学校';

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    stage: $('stage'),
    topbarTitle: $('topbarTitle'),
    notice: $('notice'),
    noticeText: $('noticeText'),
    noticeClose: $('noticeClose'),
    progressBar: $('progressBar'),
    progressFill: $('progressFill'),
    pageCounter: $('pageCounter'),
    liveRegion: $('liveRegion'),
    btnRestart: $('btnRestart'),
    btnPrev: $('btnPrev'),
    btnNext: $('btnNext'),
    btnAuto: $('btnAuto'),
    btnAutoLabel: $('btnAutoLabel'),
    btnPause: $('btnPause'),
    btnPauseLabel: $('btnPauseLabel'),
    btnVoice: $('btnVoice'),
    btnVoiceLabel: $('btnVoiceLabel')
  };

  var state = {
    story: null,
    pageCount: 0,
    index: 0,
    auto: false,
    paused: false,
    voiceOn: true
  };

  var speech = {
    supported: 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function',
    voice: null,
    noJapanese: false,
    everStarted: false
  };

  // 再生のたびに番号を進め、古いコールバックが動かないようにする（二重再生防止）
  var runToken = 0;
  var timers = [];
  var segments = [];
  var segIndex = 0;

  /* ---------------- 共通 ---------------- */

  function later(fn, ms) {
    var id = setTimeout(function () {
      timers = timers.filter(function (t) { return t !== id; });
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  function stopOutput() {
    runToken++;
    timers.forEach(clearTimeout);
    timers = [];
    if (speech.supported && (speechSynthesis.speaking || speechSynthesis.pending)) {
      speechSynthesis.cancel();
    }
  }

  function endIndex() { return state.pageCount + 1; }

  function showNotice(text) {
    el.noticeText.textContent = text;
    el.notice.hidden = false;
  }
  function hideNotice() { el.notice.hidden = true; }

  function safeUrl(url) {
    if (typeof url !== 'string') return '';
    url = url.trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function make(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'className') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // 文を「。！？」で区切る（閉じかぎ括弧は前の文に含める）
  function splitSentences(text) {
    var parts = String(text).match(/[^。！？!?]+[。！？!?]+」?|[^。！？!?]+$/g);
    return parts ? parts.map(function (s) { return s.trim(); }).filter(Boolean) : [String(text)];
  }

  /* ---------------- 音声の準備 ---------------- */

  function pickVoice() {
    if (!speech.supported) return;
    var voices = speechSynthesis.getVoices() || [];
    if (!voices.length) return; // まだ読み込まれていない
    var ja = voices.filter(function (v) { return /^ja([-_]|$)/i.test(v.lang); });
    speech.noJapanese = ja.length === 0;
    var preferred = ['Nanami', 'Kyoko', 'O-ren', 'Google', 'Haruka', 'Ayumi', 'Otoya'];
    var chosen = null;
    for (var i = 0; i < preferred.length && !chosen; i++) {
      for (var j = 0; j < ja.length; j++) {
        if (ja[j].name.indexOf(preferred[i]) !== -1) { chosen = ja[j]; break; }
      }
    }
    speech.voice = chosen || ja[0] || null;
  }

  function useVoice() {
    return state.voiceOn && speech.supported && !speech.noJapanese;
  }

  /* ---------------- 画面の描画 ---------------- */

  function render() {
    var story = state.story;
    var i = state.index;
    var view;
    if (i === 0) view = renderCover(story);
    else if (i === endIndex()) view = renderEnd(story);
    else view = renderPage(story.pages[i - 1], i);

    el.stage.innerHTML = '';
    el.stage.appendChild(view);
    segments = collectSegments();
    segIndex = 0;
    updateControls();
    preload(i + 1);
  }

  function imageFigure(src, alt) {
    var img = make('img', { src: src, alt: alt || '', width: '1280', height: '960', decoding: 'async' });
    return make('figure', { className: 'image-panel' }, [img]);
  }

  function renderCover(story) {
    var first = story.pages[0];
    var startBtn = make('button', { type: 'button', className: 'action action-primary', text: '最初から読む' });
    startBtn.addEventListener('click', function () { goTo(1); });
    var autoBtn = make('button', { type: 'button', className: 'action', text: '自動で読む（音声つき）' });
    autoBtn.addEventListener('click', function () { setAuto(true); });

    var text = make('div', { className: 'text-panel' }, [
      make('p', { className: 'cover-publisher', text: story.publisher || '' }),
      make('h1', { className: 'cover-title', text: story.bookTitle || '', tabindex: '-1' }),
      story.subtitle ? make('p', { className: 'cover-subtitle', text: story.subtitle }) : null,
      story.startText ? make('p', { className: 'cover-lead', text: story.startText }) : null,
      make('div', { className: 'cover-actions' }, [startBtn, autoBtn]),
      make('p', { className: 'cover-hint', text: '「自動で読む」を押すと、日本語の音声で読み上げ、読み終えると次のページへ進みます。音が出ない場合は、端末の音量やマナーモードをご確認ください。キーボードの ← → でもページを移動できます。' })
    ]);
    return make('article', { className: 'spread cover', 'aria-label': '表紙' }, [
      text,
      imageFigure(first.image, first.imageAlt)
    ]);
  }

  function renderPage(p, i) {
    var paragraph = make('p', { className: 'page-text' });
    splitSentences(p.text).forEach(function (s) {
      paragraph.appendChild(make('span', { 'data-speak': '', text: s }));
    });

    var children = [
      make('p', { className: 'page-label', text: 'Page ' + i + ' / ' + state.pageCount }),
      make('h2', { className: 'page-title', text: p.title, 'data-speak': '', tabindex: '-1' }),
      paragraph
    ];
    if (p.question) {
      children.push(make('div', { className: 'question' }, [
        make('span', { className: 'question-label', text: '問い' }),
        make('span', { className: 'question-text', text: p.question, 'data-speak': '' })
      ]));
    }

    return make('article', { className: 'spread', 'aria-label': i + 'ページ目' }, [
      imageFigure(p.image, p.imageAlt),
      make('div', { className: 'text-panel' }, children)
    ]);
  }

  function renderEnd(story) {
    var last = story.pages[story.pages.length - 1];
    var actions = [];
    var notes = [];

    var diagnosisUrl = safeUrl(story.diagnosisUrl);
    if (diagnosisUrl) {
      actions.push(make('a', {
        className: 'action action-primary', href: diagnosisUrl,
        target: '_blank', rel: 'noopener', text: '組織知チェックへ'
      }));
    } else {
      actions.push(make('span', {
        className: 'action', role: 'link', 'aria-disabled': 'true',
        text: '組織知チェックへ（準備中）'
      }));
      notes.push(make('p', { className: 'link-note', text: '※ 組織知チェックのリンクは、まだ設定されていません。' }));
    }

    var homeUrl = safeUrl(story.homeUrl);
    if (homeUrl) {
      actions.push(make('a', { className: 'action', href: homeUrl, text: 'おもてなしの学校HPへ戻る' }));
    }

    var again = make('button', { type: 'button', className: 'action', text: 'もう一度最初から読む' });
    again.addEventListener('click', function () { goTo(1); });
    actions.push(again);

    var text = make('div', { className: 'text-panel' }, [
      make('p', { className: 'page-label', text: 'おわりに' }),
      make('h2', { className: 'end-question', text: story.lastQuestion || '', 'data-speak': '', tabindex: '-1' }),
      make('div', { className: 'end-actions' }, actions)
    ].concat(notes, [
      make('p', { className: 'copyright', text: COPYRIGHT })
    ]));

    return make('article', { className: 'spread end', 'aria-label': '終わりのページ' }, [
      imageFigure(last.image, last.imageAlt),
      text
    ]);
  }

  function collectSegments() {
    var nodes = el.stage.querySelectorAll('[data-speak]');
    return Array.prototype.map.call(nodes, function (node) {
      return { node: node, text: node.textContent };
    });
  }

  function preload(i) {
    var p = state.story.pages[i - 1];
    if (p) { var img = new Image(); img.src = p.image; }
  }

  function updateControls() {
    var i = state.index;
    var n = state.pageCount;
    var isEnd = i === endIndex();

    var done = i === 0 ? 0 : Math.min(i, n);
    el.progressFill.style.width = (done / n * 100) + '%';
    el.progressBar.setAttribute('aria-valuenow', String(done));
    el.progressBar.setAttribute('aria-valuetext',
      i === 0 ? '表紙' : isEnd ? '読み終わりました' : n + 'ページ中 ' + i + 'ページ目');
    el.pageCounter.textContent = i === 0 ? '表紙' : isEnd ? 'おわり' : i + ' / ' + n;

    el.btnPrev.disabled = i === 0;
    el.btnNext.disabled = isEnd;

    el.btnAuto.setAttribute('aria-pressed', String(state.auto));
    el.btnAutoLabel.textContent = state.auto ? '自動を止める' : '自動で読む';

    el.btnPause.disabled = !state.auto;
    el.btnPauseLabel.textContent = state.paused ? '再開' : '一時停止';
    el.btnPause.setAttribute('aria-label', state.paused ? '再開' : '一時停止');

    el.btnVoice.setAttribute('aria-pressed', String(state.voiceOn));
    el.btnVoiceLabel.textContent = state.voiceOn ? '音声オン' : '音声オフ';

    // 押したボタンが使えなくなった場合は、本文の見出しへフォーカスを移す
    var active = document.activeElement;
    if (active && active.disabled) {
      var heading = el.stage.querySelector('[tabindex="-1"]');
      (heading || el.stage).focus();
    }
  }

  function announce() {
    var i = state.index;
    var text;
    if (i === 0) text = '表紙';
    else if (i === endIndex()) text = 'おわりのページ';
    else text = state.pageCount + 'ページ中 ' + i + 'ページ目、' + state.story.pages[i - 1].title;
    el.liveRegion.textContent = text;
  }

  /* ---------------- ページ移動 ---------------- */

  function goTo(i) {
    stopOutput();
    state.index = Math.max(0, Math.min(endIndex(), i));
    render();
    announce();
    window.scrollTo(0, 0);
    if (state.auto && !state.paused) play();
  }

  function next() { if (state.index < endIndex()) goTo(state.index + 1); }
  function prev() { if (state.index > 0) goTo(state.index - 1); }

  /* ---------------- 自動で読む ---------------- */

  function setAuto(on) {
    stopOutput();
    clearHighlight();
    state.auto = on;
    state.paused = false;
    if (on) {
      if (!useVoice()) explainSilentMode();
      else hideNotice();
      // 表紙・終了画面からは1ページ目から始める
      if (state.index === 0 || state.index === endIndex()) { goTo(1); return; }
      segIndex = 0;
      play();
    }
    updateControls();
  }

  function togglePause() {
    if (!state.auto) return;
    if (state.paused) {
      state.paused = false;
      updateControls();
      play(); // 読みかけの文の頭から再開
    } else {
      state.paused = true;
      stopOutput();
      updateControls();
    }
  }

  function play() {
    stopOutput();
    var token = runToken;
    if (useVoice()) speakNext(token);
    else silentNext(token);
  }

  function highlight(node) {
    clearHighlight();
    if (node) node.classList.add('reading');
  }
  function clearHighlight() {
    var nodes = el.stage.querySelectorAll('.reading');
    Array.prototype.forEach.call(nodes, function (n) { n.classList.remove('reading'); });
  }

  function onPageDone(token) {
    if (token !== runToken) return;
    clearHighlight();
    if (state.index >= endIndex()) {
      // 最後の問いを読み終えたら自動モードを終える
      state.auto = false;
      state.paused = false;
      updateControls();
      return;
    }
    later(function () {
      if (token === runToken && state.auto && !state.paused) next();
    }, PAGE_GAP_MS);
  }

  // 音声あり
  function speakNext(token) {
    if (token !== runToken) return;
    if (segIndex >= segments.length) { onPageDone(token); return; }

    var seg = segments[segIndex];
    highlight(seg.node);

    var finished = false;
    var started = false;
    var finish = function () {
      if (finished || token !== runToken) return;
      finished = true;
      segIndex++;
      later(function () { speakNext(token); }, SEGMENT_GAP_MS);
    };

    var u = new SpeechSynthesisUtterance(seg.text);
    u.lang = 'ja-JP';
    if (speech.voice) u.voice = speech.voice;
    u.rate = 1;
    u.pitch = 1;
    u.onstart = function () { started = true; speech.everStarted = true; };
    u.onend = finish;
    u.onerror = function (e) {
      if (token !== runToken) return;
      var err = e && e.error;
      if (err === 'interrupted' || err === 'canceled') return;
      fallbackToSilent(token);
    };

    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u); // クリック直後に同期的に呼ぶ（iPhoneの制限対策）

    // 一度も音声が始まらない場合は、音声なしに切り替える
    if (!speech.everStarted) {
      later(function () {
        if (token === runToken && !started && !finished) fallbackToSilent(token);
      }, SPEECH_START_TIMEOUT_MS);
    }
    // 終了通知が届かないブラウザ対策（念のための見張り）
    later(function () {
      if (token === runToken && !finished && started) {
        speechSynthesis.cancel();
        finish();
      }
    }, seg.text.length * 450 + 8000);
  }

  function fallbackToSilent(token) {
    if (token !== runToken) return;
    stopOutput();
    if (!speech.everStarted) speech.noJapanese = true;
    state.voiceOn = false;
    explainSilentMode();
    updateControls();
    if (state.auto && !state.paused) play();
  }

  function explainSilentMode() {
    if (!speech.supported || speech.noJapanese) {
      showNotice('お使いの端末・ブラウザでは日本語の音声読み上げを利用できないため、音声なしで自動ページ送りをしています。文章の長さに合わせてページが進みます。「一時停止」でいつでも止められます。');
    } else {
      showNotice('音声オフで自動ページ送りをしています。文章の長さに合わせてページが進みます。読み上げを聞くには「音声オフ」を押して音声オンにしてください。');
    }
  }

  // 音声なし（文章の長さに合わせた時間で進める）
  function silentNext(token) {
    if (token !== runToken) return;
    if (segIndex >= segments.length) { onPageDone(token); return; }
    var seg = segments[segIndex];
    highlight(seg.node);
    var ms = Math.max(SILENT_MIN_MS, seg.text.length * SILENT_MS_PER_CHAR);
    later(function () {
      if (token !== runToken) return;
      segIndex++;
      silentNext(token);
    }, ms);
  }

  function toggleVoice() {
    if (!state.voiceOn && (!speech.supported || speech.noJapanese)) {
      // 端末が対応していないかもしれないが、もう一度だけ試せるようにする
      if (!speech.supported) {
        showNotice('お使いのブラウザは音声読み上げに対応していません。「自動で読む」は音声なしでページを送ります。');
        return;
      }
      pickVoice();
      if (speech.noJapanese && speechSynthesis.getVoices().length) {
        showNotice('この端末には日本語の読み上げ音声が見つかりませんでした。「自動で読む」は音声なしでページを送ります。');
        return;
      }
      speech.noJapanese = false;
    }
    state.voiceOn = !state.voiceOn;
    if (state.voiceOn) hideNotice();
    else if (state.auto) explainSilentMode();

    // 切り替えたらこのページの最初から読み直す
    stopOutput();
    clearHighlight();
    segIndex = 0;
    updateControls();
    if (state.auto && !state.paused) play();
  }

  /* ---------------- 操作の登録 ---------------- */

  function bindEvents() {
    el.btnRestart.addEventListener('click', function () { goTo(1); });
    el.btnPrev.addEventListener('click', prev);
    el.btnNext.addEventListener('click', next);
    el.btnAuto.addEventListener('click', function () { setAuto(!state.auto); });
    el.btnPause.addEventListener('click', togglePause);
    el.btnVoice.addEventListener('click', toggleVoice);
    el.noticeClose.addEventListener('click', hideNotice);

    document.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = (e.target && e.target.tagName) || '';
      var onControl = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(tag);
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if ((e.key === ' ' || e.key === 'Spacebar') && !onControl && state.auto) { e.preventDefault(); togglePause(); }
    });

    // スマホのスワイプでページ移動
    var startX = null, startY = null;
    el.stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { startX = null; return; }
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    }, { passive: true });
    el.stage.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) next(); else prev();
      }
    }, { passive: true });

    // 別のタブやアプリに切り替えたら一時停止
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.auto && !state.paused) togglePause();
    });
    window.addEventListener('pagehide', stopOutput);

    if (speech.supported) {
      pickVoice();
      if (typeof speechSynthesis.addEventListener === 'function') {
        speechSynthesis.addEventListener('voiceschanged', pickVoice);
      } else {
        speechSynthesis.onvoiceschanged = pickVoice;
      }
      // 前回のページの読み上げが残っていれば止める
      speechSynthesis.cancel();
    } else {
      state.voiceOn = false;
    }
  }

  /* ---------------- 起動 ---------------- */

  function showLoadError() {
    el.stage.innerHTML =
      '<div class="error-box" role="alert">' +
      '<h2>絵本のデータ（story.json）を読み込めませんでした</h2>' +
      '<p>index.html をダブルクリックで直接開くと、ブラウザの安全機能により読み込めないことがあります。</p>' +
      '<p>README.md の「パソコンで試す方法」にある手順（<code>python -m http.server</code> など）で開くか、GitHub Pages で公開したページをご覧ください。</p>' +
      '</div>';
    [el.btnRestart, el.btnPrev, el.btnNext, el.btnAuto, el.btnPause, el.btnVoice].forEach(function (b) { b.disabled = true; });
  }

  function start(story) {
    if (!story || !Array.isArray(story.pages) || !story.pages.length) throw new Error('invalid story');
    state.story = story;
    state.pageCount = story.pages.length;
    el.progressBar.setAttribute('aria-valuemax', String(state.pageCount));
    if (story.bookTitle) {
      el.topbarTitle.textContent = story.bookTitle;
      document.title = story.bookTitle + '｜おもてなしの学校';
    }
    render();
  }

  bindEvents();

  fetch(STORY_URL, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(start)
    .catch(function (err) {
      if (window.console) console.error(err);
      showLoadError();
    });
})();
