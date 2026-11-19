/* @ds-bundle: {"format":4,"namespace":"Sinho","components":[{"name":"Masthead"},{"name":"LanguageSwitch"},{"name":"Tabs"},{"name":"Footer"},{"name":"Button"},{"name":"SubscribeBox"},{"name":"TextField"},{"name":"Select"},{"name":"SegmentedControl"},{"name":"Switch"},{"name":"Checkbox"},{"name":"Tag"},{"name":"StoryCard"},{"name":"IssueHero"},{"name":"ArticleHeader"},{"name":"Figure"},{"name":"LaneRule"},{"name":"Insight"},{"name":"PaperCard"},{"name":"KeyFindings"},{"name":"StatTile"},{"name":"Delta"},{"name":"Sparkline"},{"name":"LineChart"},{"name":"BarChart"},{"name":"Legend"},{"name":"ChartTooltip"},{"name":"ChartCard"},{"name":"DataTable"},{"name":"Notice"},{"name":"Skeleton"},{"name":"EmptyState"},{"name":"InfographicFrame"},{"name":"Ticker"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  /* ---------- helpers ---------- */
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function omit(o, keys) { var r = {}; for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k) && keys.indexOf(k) < 0) r[k] = o[k]; } return r; }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  var uid = 0; function useId(prefix) { var r = React.useRef(null); if (r.current === null) { uid += 1; r.current = (prefix || 'sn') + '-' + uid; } return r.current; }
  function useControlled(value, defaultValue, onChange) {
    var s = React.useState(defaultValue), inner = s[0], setInner = s[1];
    var controlled = value !== undefined;
    return [controlled ? value : inner, function (v) { if (!controlled) setInner(v); if (onChange) onChange(v); }];
  }

  /* ---------- i18n: built-in strings (EN / KO) ---------- */
  var STRINGS = {
    en: {
      paper: 'The paper', openAccess: 'Open access', findings: 'Key findings', ourRead: 'Our read', source: 'Source: ',
      save: 'Save', share: 'Share', subscribe: 'Subscribe', email: 'Email address', subTitle: 'The city, in numbers, every week',
      subDone: 'Check your inbox to confirm your subscription.', newTag: 'New', primaryNav: 'Primary', language: 'Language',
      chart: 'Chart', table: 'Table', download: 'Download CSV', updated: 'Updated', loading: 'Loading', empty: 'No data for this selection',
      up: 'up', down: 'down', flat: 'unchanged', footerNav: 'Footer', sortAsc: 'sorted ascending', sortDesc: 'sorted descending',
      issue: function (n) { return 'Issue ' + n; }, live: 'Live'
    },
    ko: {
      paper: '논문 정보', openAccess: '오픈 액세스', findings: '핵심 결과', ourRead: '편집자의 해석', source: '출처: ',
      save: '저장', share: '공유', subscribe: '구독하기', email: '이메일 주소', subTitle: '매주 받아보는 숫자로 본 도시',
      subDone: '받은편지함에서 구독 확인 메일을 눌러 주세요.', newTag: '새 글', primaryNav: '주요 메뉴', language: '언어',
      chart: '차트', table: '표', download: 'CSV 다운로드', updated: '업데이트', loading: '불러오는 중', empty: '선택한 조건에 맞는 데이터가 없습니다',
      up: '상승', down: '하락', flat: '변동 없음', footerNav: '하단 메뉴', sortAsc: '오름차순 정렬됨', sortDesc: '내림차순 정렬됨',
      issue: function (n) { return '제' + Number(n) + '호'; }, live: '실시간'
    }
  };
  function langOf(p) {
    if (p && p.lang) return p.lang.slice(0, 2);
    var d = typeof document !== 'undefined' && document.documentElement.getAttribute('lang');
    return d ? d.slice(0, 2) : 'en';
  }
  function t(p, key) { var L = STRINGS[langOf(p)] || STRINGS.en; return L[key] != null ? L[key] : STRINGS.en[key]; }

  /* ---------- formatting (Intl, typographic minus) ---------- */
  var LOCALE = { en: 'en-GB', ko: 'ko-KR' };
  function minus(s) { return String(s).replace(/^-/, '−').replace(/(\s)-/g, '$1−'); }
  function formatNumber(v, o) {
    o = o || {};
    if (v == null || isNaN(v)) return '–';
    var opts = { maximumFractionDigits: o.decimals != null ? o.decimals : 1, minimumFractionDigits: o.decimals != null ? o.decimals : 0 };
    if (o.compact) opts.notation = 'compact';
    if (o.signed) opts.signDisplay = 'exceptZero';
    var s = new Intl.NumberFormat(LOCALE[o.lang || 'en'] || o.lang, opts).format(v);
    return minus(s) + (o.unit || '');
  }
  function formatDate(d, o) {
    o = o || {}; d = d instanceof Date ? d : new Date(d);
    var loc = LOCALE[o.lang || 'en'];
    var style = o.style || 'byline';
    var opt = style === 'feed' ? { day: 'numeric', month: o.lang === 'ko' ? 'long' : 'short' }
      : style === 'month' ? { year: 'numeric', month: o.lang === 'ko' ? 'long' : 'short' }
      : { day: 'numeric', month: o.lang === 'ko' ? 'long' : 'short', year: 'numeric' };
    return new Intl.DateTimeFormat(loc, opt).format(d);
  }

  /* ---------- icons (Lucide-style, 1.5px stroke) ---------- */
  function svgIcon(paths, extra) {
    return h('svg', Object.assign({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' }, extra || {}),
      paths.map(function (d, i) { return h('path', { key: i, d: d }); }));
  }
  var ICONS = {
    bookmark: ['M6 3.5h12v17l-6-4-6 4z'],
    share: ['M12 15V3.5', 'M7.5 8 12 3.5 16.5 8', 'M5 12.5v7h14v-7'],
    unlock: ['M5 11h14v9.5H5z', 'M8 11V7.5a4 4 0 0 1 7.6-1.7'],
    download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'],
    chevron: ['M6 9l6 6 6-6'],
    info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 7.6v.1'],
    good: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12.2l2.7 2.7L16 9.6'],
    warning: ['M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0z', 'M12 9.5v4', 'M12 17v.1'],
    critical: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9 9l6 6', 'M15 9l-6 6'],
    globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3z'],
    sort: ['M8 9l4-4 4 4', 'M8 15l4 4 4-4']
  };

  /* ---------- decorative crosswalk (signboard blocks) ---------- */
  var STRIPES = [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { var x = 120 + i * 56; return [x, 0, x + 28, 0, x - 52, 320, x - 80, 320].join(' '); });
  function LaneArt() {
    return h('svg', { className: 'sn-lane-art', viewBox: '0 0 480 320', preserveAspectRatio: 'xMaxYMid slice', 'aria-hidden': true, focusable: 'false' },
      STRIPES.map(function (pts, i) { return h('polygon', { key: i, points: pts, className: 'is-stripe' }); }),
      [344, 392, 440].map(function (x, i) { return h('rect', { key: 'f' + i, x: x, y: 40, width: 32, height: 6, className: 'is-flash' }); }));
  }

  /* =====================================================================
     Navigation
     ===================================================================== */
  function Masthead(p) {
    var links = p.links || [];
    return h('header', { className: cx('sn-mast', p.className) },
      h('a', { className: 'sn-wordmark', href: p.href || '/' }, p.name || 'Sinho'),
      links.length ? h('nav', { className: 'sn-mast__nav', 'aria-label': t(p, 'primaryNav') },
        links.map(function (l, i) { return h('a', { key: i, href: l.href || '#', 'aria-current': l.active ? 'page' : undefined }, l.label); })) : null,
      h('div', { className: 'sn-mast__actions' }, p.actions));
  }

  function LanguageSwitch(p) {
    var opts = p.options || [{ code: 'en', label: 'EN', href: '#' }, { code: 'ko', label: '한국어', href: '#' }];
    var cur = p.current || langOf(p);
    return h('nav', { className: cx('sn-lang', p.className), 'aria-label': t(p, 'language') },
      p.showIcon !== false ? h('span', { className: 'sn-lang__icon' }, svgIcon(ICONS.globe)) : null,
      opts.map(function (o, i) {
        return h(React.Fragment, { key: o.code },
          i > 0 ? h('span', { className: 'sn-lang__sep', 'aria-hidden': true }, '/') : null,
          h('a', { href: o.href || '#', lang: o.code, hrefLang: o.code, 'aria-current': o.code === cur ? 'true' : undefined, onClick: o.onClick }, o.label));
      }));
  }

  function Tabs(p) {
    var items = p.items || [];
    var st = useControlled(p.value, p.defaultValue != null ? p.defaultValue : (items[0] && items[0].id), p.onChange), val = st[0], setVal = st[1];
    var refs = React.useRef([]);
    function onKey(e, i) {
      var n = items.length, j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % n; else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = n - 1;
      if (j !== null) { e.preventDefault(); setVal(items[j].id); if (refs.current[j]) refs.current[j].focus(); }
    }
    return h('div', { className: cx('sn-tabs', p.className), role: 'tablist', 'aria-label': p.label },
      items.map(function (it, i) {
        var sel = it.id === val;
        return h('button', { key: it.id, ref: function (el) { refs.current[i] = el; }, type: 'button', role: 'tab', id: it.tabId, 'aria-selected': sel, 'aria-controls': it.panelId, tabIndex: sel ? 0 : -1, className: 'sn-tab', onClick: function () { setVal(it.id); }, onKeyDown: function (e) { onKey(e, i); } },
          it.label, it.count != null ? h('span', { className: 'sn-tab__count' }, it.count) : null);
      }));
  }

  function Footer(p) {
    var links = p.links || [];
    return h('footer', { className: cx('sn-foot', p.className) },
      h('div', { className: 'sn-foot__row' },
        h('a', { className: 'sn-wordmark sn-wordmark--sm', href: p.href || '/' }, p.name || 'Sinho'),
        p.languageSwitch || null),
      links.length ? h('nav', { className: 'sn-foot__nav', 'aria-label': t(p, 'footerNav') },
        links.map(function (l, i) { return h('a', { key: i, href: l.href || '#' }, l.label); })) : null,
      p.note ? h('p', { className: 'sn-foot__note' }, p.note) : null);
  }

  /* =====================================================================
     Actions & forms
     ===================================================================== */
  function Button(p) {
    var variant = p.variant || 'secondary';
    var cls = cx('sn-btn', 'sn-btn--' + variant, p.size === 'sm' && 'sn-btn--sm', p.className);
    var rest = omit(p, ['variant', 'size', 'className', 'children', 'href', 'icon', 'lang']);
    var kids = [p.icon && ICONS[p.icon] ? h(React.Fragment, { key: 'i' }, svgIcon(ICONS[p.icon])) : null, p.children != null ? h(React.Fragment, { key: 'c' }, p.children) : null];
    if (p.href) return h('a', Object.assign({ className: cls, href: p.href }, rest), kids);
    return h('button', Object.assign({ type: 'button', className: cls }, rest), kids);
  }

  function SubscribeBox(p) {
    var st = React.useState(false), done = st[0], setDone = st[1];
    var id = useId('sn-sub');
    function submit(e) {
      e.preventDefault();
      var email = e.currentTarget.elements.email.value;
      if (p.onSubmit) p.onSubmit(email);
      setDone(true);
    }
    return h('section', { className: cx('sn-sub', p.className), 'aria-labelledby': id + '-t' },
      h(LaneArt),
      h('div', { className: 'sn-sub__inner' },
        h('h2', { className: 'sn-sub__title', id: id + '-t' }, p.title || t(p, 'subTitle')),
        p.body ? h('p', { className: 'sn-sub__body' }, p.body) : null,
        done
          ? h('p', { className: 'sn-sub__done', role: 'status' }, p.doneMessage || t(p, 'subDone'))
          : h('form', { className: 'sn-sub__form', onSubmit: submit },
              h('label', { className: 'sn-visually-hidden', htmlFor: id + '-e' }, t(p, 'email')),
              h('input', { className: 'sn-sub__input', id: id + '-e', name: 'email', type: 'email', required: true, autoComplete: 'email', placeholder: p.placeholder || 'you@example.com' }),
              h(Button, { variant: 'deep', type: 'submit' }, p.buttonLabel || t(p, 'subscribe'))),
        p.fine && !done ? h('p', { className: 'sn-sub__fine' }, p.fine) : null));
  }

  function Field(p, control) {
    return h('div', { className: cx('sn-field', p.error && 'is-invalid', p.className), style: p.width ? { width: p.width } : undefined },
      p.label ? h('label', { className: 'sn-field__label', htmlFor: p._id }, p.label) : null,
      control,
      p.error ? h('p', { className: 'sn-field__error', id: p._id + '-m' }, svgIcon(ICONS.critical), h('span', null, p.error))
        : p.hint ? h('p', { className: 'sn-field__hint', id: p._id + '-m' }, p.hint) : null);
  }

  function TextField(p) {
    var id = useId('sn-tf'); var fid = p.id || id;
    var rest = omit(p, ['label', 'hint', 'error', 'className', 'width', 'lang', 'id']);
    return Field(Object.assign({}, p, { _id: fid }),
      h('input', Object.assign({ id: fid, className: 'sn-input', type: 'text', 'aria-invalid': p.error ? true : undefined, 'aria-describedby': (p.error || p.hint) ? fid + '-m' : undefined }, rest)));
  }

  function Select(p) {
    var id = useId('sn-sel'); var fid = p.id || id;
    var rest = omit(p, ['label', 'hint', 'error', 'className', 'width', 'options', 'lang', 'id']);
    return Field(Object.assign({}, p, { _id: fid }),
      h('div', { className: 'sn-select' },
        h('select', Object.assign({ id: fid, className: 'sn-input sn-select__el', 'aria-describedby': (p.error || p.hint) ? fid + '-m' : undefined }, rest),
          (p.options || []).map(function (o) { return h('option', { key: o.value, value: o.value }, o.label); })),
        h('span', { className: 'sn-select__chev' }, svgIcon(ICONS.chevron))));
  }

  function SegmentedControl(p) {
    var opts = p.options || [];
    var st = useControlled(p.value, p.defaultValue != null ? p.defaultValue : (opts[0] && opts[0].value), p.onChange), val = st[0], setVal = st[1];
    var refs = React.useRef([]);
    function onKey(e, i) {
      var n = opts.length, j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n; else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      if (j !== null) { e.preventDefault(); setVal(opts[j].value); if (refs.current[j]) refs.current[j].focus(); }
    }
    return h('div', { className: cx('sn-seg', p.size === 'sm' && 'sn-seg--sm', p.className), role: 'radiogroup', 'aria-label': p.label },
      opts.map(function (o, i) {
        var sel = o.value === val;
        return h('button', { key: o.value, ref: function (el) { refs.current[i] = el; }, type: 'button', role: 'radio', 'aria-checked': sel, tabIndex: sel ? 0 : -1, className: 'sn-seg__opt', onClick: function () { setVal(o.value); }, onKeyDown: function (e) { onKey(e, i); } }, o.label);
      }));
  }

  function Switch(p) {
    var st = useControlled(p.checked, !!p.defaultChecked, p.onChange), on = st[0], setOn = st[1];
    var id = useId('sn-sw');
    return h('div', { className: cx('sn-switch', p.className) },
      h('button', { type: 'button', role: 'switch', id: id, 'aria-checked': on, className: 'sn-switch__track', onClick: function () { setOn(!on); }, disabled: p.disabled },
        h('span', { className: 'sn-switch__thumb' })),
      h('label', { htmlFor: id, className: 'sn-switch__label' }, p.label));
  }

  function Checkbox(p) {
    var rest = omit(p, ['label', 'swatch', 'className', 'lang']);
    return h('label', { className: cx('sn-check', p.className) },
      h('input', Object.assign({ type: 'checkbox', className: 'sn-check__box' }, rest)),
      p.swatch ? h('span', { className: 'sn-check__swatch', style: { background: seriesColor(p.swatch) }, 'aria-hidden': true }) : null,
      h('span', null, p.label));
  }

  /* =====================================================================
     Feed & article (newsletter)
     ===================================================================== */
  function Tag(p) {
    var kind = p.kind || 'topic';
    var cls = cx('sn-tag', kind !== 'topic' && 'sn-tag--' + kind, p.className);
    return p.href ? h('a', { className: cls, href: p.href }, p.children) : h('span', { className: cls }, p.children);
  }

  function StoryCard(p) {
    var thumb = null;
    if (p.thumbnail) {
      thumb = h('div', { className: 'sn-story__thumb' },
        typeof p.thumbnail === 'string' ? h('img', { src: p.thumbnail, alt: p.thumbnailAlt || '', loading: 'lazy' }) : p.thumbnail);
    }
    var meta = [];
    if (p.isNew) meta.push(h(Tag, { key: 'n', kind: 'new' }, t(p, 'newTag')));
    var when = [p.date, p.readTime].filter(Boolean).join(' · ');
    if (when) meta.push(h('span', { key: 'w' }, when));
    (p.tags || []).forEach(function (tg, i) { meta.push(h(Tag, { key: 't' + i, kind: 'jel' }, tg)); });
    return h('article', { className: cx('sn-story', p.className), lang: p.lang },
      h('div', { className: 'sn-story__body' },
        p.kicker ? h('p', { className: 'sn-story__kicker' }, p.kicker) : null,
        h('a', { className: 'sn-story__link', href: p.href || '#' },
          h('h3', { className: 'sn-story__title' }, p.title),
          p.dek ? h('p', { className: 'sn-story__dek' }, p.dek) : null),
        meta.length ? h('div', { className: 'sn-story__meta' }, meta) : null),
      thumb);
  }

  function IssueHero(p) {
    var id = useId('sn-hero');
    var kicker = [t(p, 'issue')(p.issue), p.date].filter(Boolean).join(' · ');
    return h('section', { className: cx('sn-hero', p.className), 'aria-labelledby': id, lang: p.lang },
      h(LaneArt),
      h('div', { className: 'sn-hero__inner' },
        h('p', { className: 'sn-hero__kicker' }, kicker),
        h('h1', { className: 'sn-hero__title', id: id }, p.title),
        p.note ? h('p', { className: 'sn-hero__note' }, p.note) : null,
        p.meta ? h('p', { className: 'sn-hero__meta' }, p.meta) : null,
        p.children));
  }

  function initials(name) {
    var s = String(name || '').trim();
    if (/[가-힣]/.test(s)) return s.replace(/\s+/g, '').slice(0, 2);
    return s.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }

  function ArticleHeader(p) {
    var meta = [p.role, p.readTime, p.date].filter(Boolean).join(' · ');
    var actions = p.actions !== undefined ? p.actions : [
      h(Button, { key: 's', variant: 'quiet', icon: 'bookmark', 'aria-label': t(p, 'save'), onClick: p.onSave }),
      h(Button, { key: 'h', variant: 'quiet', icon: 'share', 'aria-label': t(p, 'share'), onClick: p.onShare })
    ];
    return h('header', { className: cx('sn-ahead', p.className), lang: p.lang },
      p.kicker ? h('p', { className: 'sn-kicker' }, p.kicker) : null,
      h('h1', { className: 'sn-ahead__title' }, p.title),
      p.subtitle ? h('p', { className: 'sn-ahead__dek' }, p.subtitle) : null,
      h('div', { className: 'sn-byline' },
        h('span', { className: 'sn-avatar', 'aria-hidden': true }, p.authorInitials || initials(p.author)),
        h('div', null,
          h('p', { className: 'sn-byline__name' }, p.author),
          meta ? h('p', { className: 'sn-byline__meta' }, meta) : null)),
      h('div', { className: 'sn-actionbar' },
        h('div', { className: 'sn-actionbar__group' }, p.leading || null),
        h('div', { className: 'sn-actionbar__group' }, actions)));
  }

  function PaperCard(p) {
    var facts = p.facts || [];
    var venue = [p.citation, p.year].filter(Boolean).join(', ');
    var pl = p.paperLang || 'en';
    return h('aside', { className: cx('sn-paper', p.className), 'aria-label': p.label || t(p, 'paper'), lang: p.lang },
      h('div', { className: 'sn-paper__head' },
        h('p', { className: 'sn-kicker sn-kicker--muted' }, p.label || t(p, 'paper')),
        p.openAccess ? h('span', { className: 'sn-chip-oa' }, svgIcon(ICONS.unlock), t(p, 'openAccess')) : null),
      h('p', { className: 'sn-paper__title', lang: pl }, p.title),
      p.titleTranslated ? h('p', { className: 'sn-paper__title-tr' }, p.titleTranslated) : null,
      p.authors ? h('p', { className: 'sn-paper__authors', lang: pl }, p.authors) : null,
      p.journal ? h('p', { className: 'sn-paper__venue', lang: pl }, h('em', null, p.journal), venue ? ', ' + venue : null) : null,
      facts.length ? h('dl', { className: 'sn-paper__facts' },
        facts.map(function (f, i) { return h(React.Fragment, { key: i }, h('dt', null, f.label), h('dd', null, f.value)); })) : null,
      (p.doi || (p.jel && p.jel.length)) ? h('div', { className: 'sn-paper__foot' },
        p.doi ? h('a', { className: 'sn-doi', href: p.href || ('https://doi.org/' + p.doi), lang: 'en' }, 'doi:' + p.doi) : null,
        p.jel && p.jel.length ? h('span', { className: 'sn-tags' }, p.jel.map(function (j, i) { return h(Tag, { key: i, kind: 'jel' }, j); })) : null) : null);
  }

  function KeyFindings(p) {
    var items = p.items || [];
    var title = p.title || t(p, 'findings');
    return h('section', { className: cx('sn-findings', p.className), 'aria-label': title, lang: p.lang },
      h('h2', { className: 'sn-findings__title' }, title),
      h('ol', { className: 'sn-findings__list' },
        items.map(function (it, i) {
          return h('li', { key: i, className: 'sn-findings__item' },
            h('span', { className: 'sn-findings__num', 'aria-hidden': true }, pad2(i + 1)),
            h('span', { className: 'sn-findings__text' }, it));
        })));
  }

  function LaneRule(p) {
    return h('div', { className: cx('sn-lane', p && p.className), role: 'separator' }, h('span'), h('span'), h('span'));
  }

  function Insight(p) {
    var label = p.label || t(p, 'ourRead');
    var body = typeof p.children === 'string' ? h('p', null, p.children) : p.children;
    return h('aside', { className: cx('sn-insight', p.className), 'aria-label': label, lang: p.lang },
      h(LaneRule),
      h('p', { className: 'sn-insight__label' }, label),
      h('div', { className: 'sn-insight__body' }, body),
      p.by ? h('p', { className: 'sn-insight__by' }, '— ' + p.by) : null);
  }

  function Figure(p) {
    var width = p.width || 'column';
    var media = p.src
      ? h('img', { className: 'sn-figure__media', src: p.src, alt: p.alt || '', loading: 'lazy' })
      : h('div', { className: 'sn-figure__media', role: p.alt ? 'img' : undefined, 'aria-label': p.alt || undefined }, p.children);
    return h('figure', { className: cx('sn-figure', 'sn-figure--' + width, p.className), lang: p.lang },
      media,
      (p.caption || p.source) ? h('figcaption', null,
        p.caption || null,
        p.source ? h('span', { className: 'sn-figure__source' }, t(p, 'source') + p.source) : null) : null);
  }

  /* =====================================================================
     Data: figures, deltas, charts
     ===================================================================== */
  function seriesColor(c) {
    if (c === 'focus') return 'var(--viz-focus)';
    if (c === 'context') return 'var(--viz-context)';
    if (typeof c === 'string' && c.indexOf('var(') === 0) return c;
    return 'var(--viz-' + (c || 1) + ')';
  }

  var ARROW = { up: 'M6 1.5 11 9H1z', down: 'M6 10.5 1 3h10z', flat: 'M1 6h8M7 3l3 3-3 3' };
  function Delta(p) {
    var dir = p.direction || 'flat';
    var tone = p.tone || 'neutral';
    return h('span', { className: cx('sn-delta', 'sn-delta--' + tone, p.className) },
      h('svg', { viewBox: '0 0 12 12', className: 'sn-delta__arrow', 'aria-hidden': true, focusable: 'false' },
        dir === 'flat' ? h('path', { d: ARROW.flat, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }) : h('path', { d: ARROW[dir], fill: 'currentColor' })),
      h('span', { className: 'sn-visually-hidden' }, t(p, dir) + ' '),
      h('span', null, minus(p.value)));
  }

  function Sparkline(p) {
    var data = (p.data || []).filter(function (v) { return v != null; });
    var w = p.width || 112, hgt = p.height || 32, pad = 4;
    if (data.length < 2) return null;
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data), span = max - min || 1;
    var x = function (i) { return pad + i * (w - 2 * pad) / (data.length - 1); };
    var y = function (v) { return hgt - pad - (v - min) / span * (hgt - 2 * pad); };
    var d = data.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    var lx = x(data.length - 1), ly = y(data[data.length - 1]);
    return h('svg', { className: cx('sn-spark', p.className), width: w, height: hgt, viewBox: '0 0 ' + w + ' ' + hgt, role: p.label ? 'img' : undefined, 'aria-label': p.label, 'aria-hidden': p.label ? undefined : true },
      h('path', { d: d, className: 'sn-spark__line' }),
      h('circle', { cx: lx, cy: ly, r: 3, className: 'sn-spark__dot' }));
  }

  function StatTile(p) {
    return h('div', { className: cx('sn-stat', p.hero && 'sn-stat--hero', p.className), lang: p.lang },
      h('p', { className: 'sn-stat__label' }, p.label),
      h('p', { className: 'sn-stat__value' }, minus(p.value), p.unit ? h('span', { className: 'sn-stat__unit' }, p.unit) : null),
      (p.delta || p.period) ? h('p', { className: 'sn-stat__delta' },
        p.delta ? h(Delta, Object.assign({ lang: p.lang }, p.delta)) : null,
        p.period ? h('span', { className: 'sn-stat__period' }, p.period) : null) : null,
      p.trend ? h('div', { className: 'sn-stat__trend' }, h(Sparkline, { data: p.trend, width: p.hero ? 200 : 112, height: p.hero ? 40 : 32, label: p.trendLabel })) : null,
      p.source ? h('p', { className: 'sn-stat__source' }, p.source) : null);
  }

  function ChartTooltip(p) {
    var rows = p.rows || [];
    return h('div', { className: cx('sn-tip', p.className), role: 'presentation', style: p.style },
      p.title ? h('p', { className: 'sn-tip__title' }, p.title) : null,
      rows.map(function (r, i) {
        return h('p', { key: i, className: 'sn-tip__row' },
          h('span', { className: cx('sn-tip__key', r.type === 'bar' && 'sn-tip__key--bar'), style: { background: seriesColor(r.color) }, 'aria-hidden': true }),
          h('span', { className: 'sn-tip__value' }, r.value),
          h('span', { className: 'sn-tip__label' }, r.label));
      }));
  }

  function Legend(p) {
    var items = p.items || [];
    var hidden = p.hidden || [];
    return h('ul', { className: cx('sn-legend', p.className), 'aria-label': p.label },
      items.map(function (it) {
        var key = h('span', { className: cx('sn-legend__key', 'sn-legend__key--' + (it.type || 'line'), it.dashed && 'is-dashed'), style: { '--k': seriesColor(it.color) }, 'aria-hidden': true });
        var off = hidden.indexOf(it.id) >= 0;
        return h('li', { key: it.id || it.label },
          p.onToggle
            ? h('button', { type: 'button', className: cx('sn-legend__item', off && 'is-off'), 'aria-pressed': !off, onClick: function () { p.onToggle(it.id); } }, key, it.label)
            : h('span', { className: 'sn-legend__item' }, key, it.label));
      }));
  }

  function useWidth(ref, fallback) {
    var s = React.useState(fallback), w = s[0], setW = s[1];
    React.useEffect(function () {
      var el = ref.current; if (!el) return undefined;
      var measure = function () { var cw = Math.round(el.getBoundingClientRect().width); if (cw > 0) setW(cw); };
      measure();
      if (typeof ResizeObserver === 'undefined') return undefined;
      var ro = new ResizeObserver(measure); ro.observe(el);
      return function () { ro.disconnect(); };
    }, []);
    return w;
  }
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    var span = max - min, raw = span / (count || 4), mag = Math.pow(10, Math.floor(Math.log10(raw))), err = raw / mag;
    var step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (var v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function LineChart(p) {
    var ref = React.useRef(null);
    var w = useWidth(ref, p.width || 640);
    var sc = p.scale || 1;
    var height = p.height || 320;
    var hidden = p.hidden || [];
    var series = (p.series || []).filter(function (s) { return hidden.indexOf(s.id) < 0; });
    var xs = p.x || [];
    var n = xs.length;
    var fmt = p.yFormat || function (v) { return formatNumber(v, { lang: langOf(p), decimals: 1 }); };
    var all = []; series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    if (p.yMin != null) all.push(p.yMin); if (p.yMax != null) all.push(p.yMax);
    var ticks = niceTicks(Math.min.apply(null, all.length ? all : [0]), Math.max.apply(null, all.length ? all : [1]), p.yTickCount || 4);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var tickFmt = p.yTickFormat || fmt;
    var m = { t: 12 * sc, r: 12 * sc, b: 28 * sc, l: 44 * sc };
    var ph = height - m.t - m.b;
    var Y = function (v) { return m.t + ph - (v - y0) / (y1 - y0) * ph; };
    var last = function (vals) { for (var i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i; return -1; };
    var ends = series.map(function (s) { var i = last(s.values); return { s: s, i: i, y: i >= 0 ? Y(s.values[i]) : 0 }; });
    var sorted = ends.slice().sort(function (a, b) { return a.y - b.y; });
    var collide = false; for (var k = 1; k < sorted.length; k++) if (sorted[k].y - sorted[k - 1].y < 15 * sc) collide = true;
    /* direct end-labels only when they separate cleanly; otherwise the Legend carries identity */
    var showLabels = p.endLabels !== false && series.length <= 4 && !collide;
    if (showLabels) m.r = (p.labelSpace || 96) * sc;
    var pw = Math.max(40, w - m.l - m.r);
    var X = function (i) { return m.l + (n <= 1 ? pw / 2 : i * pw / (n - 1)); };
    var path = function (vals) { var d = '', pen = false; vals.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' '; pen = true; }); return d; };
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / (64 * sc)))));
    var hs = React.useState(null), hover = hs[0], setHover = hs[1];
    function locate(e) {
      var r = e.currentTarget.getBoundingClientRect();
      var px = (e.clientX - r.left) * (w / r.width);
      var i = Math.round((px - m.l) / (pw / Math.max(1, n - 1)));
      setHover(Math.max(0, Math.min(n - 1, i)));
    }
    function onKey(e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); setHover(hover == null ? 0 : Math.min(n - 1, hover + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setHover(hover == null ? n - 1 : Math.max(0, hover - 1)); }
      if (e.key === 'Escape') setHover(null);
    }
    var tip = null;
    if (hover != null) {
      var left = X(hover) + 12 * sc, flip = X(hover) > w * 0.62;
      tip = h(ChartTooltip, { title: xs[hover], style: flip ? { right: (w - X(hover) + 12 * sc) + 'px', top: m.t + 'px' } : { left: left + 'px', top: m.t + 'px' },
        rows: series.map(function (s) { return { label: s.label, value: s.values[hover] == null ? '–' : fmt(s.values[hover]), color: s.color }; }) });
    }
    return h('div', { ref: ref, className: cx('sn-chart', p.className), style: { '--sc': sc, height: height + 'px' } },
      h('svg', { width: w, height: height, viewBox: '0 0 ' + w + ' ' + height, role: 'img', 'aria-label': p.ariaLabel, tabIndex: 0, onKeyDown: onKey, onBlur: function () { setHover(null); }, onPointerMove: locate, onPointerLeave: function () { setHover(null); } },
        (p.bands || []).map(function (b, i) {
          return h('g', { key: 'b' + i },
            h('rect', { x: X(b.from), y: m.t, width: Math.max(1, X(b.to) - X(b.from)), height: ph, className: 'sn-chart__band' }),
            b.label ? h('text', { x: X(b.from) + 4 * sc, y: m.t + 12 * sc, className: 'sn-chart__bandlabel' }, b.label) : null);
        }),
        ticks.map(function (tv) {
          return h('g', { key: 'y' + tv },
            h('line', { x1: m.l, x2: m.l + pw, y1: Y(tv), y2: Y(tv), className: tv === 0 ? 'sn-chart__zero' : 'sn-chart__grid' }),
            h('text', { x: m.l - 8 * sc, y: Y(tv) + 4 * sc, textAnchor: 'end', className: 'sn-chart__tick' }, tickFmt(tv)));
        }),
        xs.map(function (lab, i) {
          return (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every * 0.6) ? h('text', { key: 'x' + i, x: X(i), y: height - 8 * sc, textAnchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', className: 'sn-chart__tick' }, lab) : null;
        }),
        series.map(function (s) {
          return h('g', { key: s.id },
            p.area && series.length === 1 ? h('path', { d: path(s.values) + 'L' + X(last(s.values)) + ' ' + Y(Math.max(y0, 0)) + ' L' + X(0) + ' ' + Y(Math.max(y0, 0)) + ' Z', className: 'sn-chart__area', style: { fill: seriesColor(s.color) } }) : null,
            h('path', { d: path(s.values), className: cx('sn-chart__line', s.dashed && 'is-dashed'), style: { stroke: seriesColor(s.color) } }));
        }),
        ends.map(function (e) { return e.i >= 0 ? h('circle', { key: 'e' + e.s.id, cx: X(e.i), cy: e.y, r: 4 * sc, className: 'sn-chart__dot', style: { fill: seriesColor(e.s.color) } }) : null; }),
        showLabels ? ends.map(function (e) { return e.i >= 0 ? h('text', { key: 'l' + e.s.id, x: X(e.i) + 10 * sc, y: e.y + 4 * sc, className: 'sn-chart__endlabel' }, e.s.label) : null; }) : null,
        hover != null ? h('g', null,
          h('line', { x1: X(hover), x2: X(hover), y1: m.t, y2: m.t + ph, className: 'sn-chart__cross' }),
          series.map(function (s) { var v = s.values[hover]; return v == null ? null : h('circle', { key: 'h' + s.id, cx: X(hover), cy: Y(v), r: 4 * sc, className: 'sn-chart__dot', style: { fill: seriesColor(s.color) } }); })) : null),
      tip);
  }

  function barPath(x0, x1, y, hgt, r) {
    var len = Math.abs(x1 - x0); r = Math.min(r, len / 2, hgt / 2);
    if (len < 0.5) return '';
    if (x1 >= x0) return 'M' + x0 + ' ' + y + 'H' + (x1 - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + x1 + ' ' + (y + r) + 'V' + (y + hgt - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x1 - r) + ' ' + (y + hgt) + 'H' + x0 + 'Z';
    return 'M' + x0 + ' ' + y + 'H' + (x1 + r) + 'A' + r + ' ' + r + ' 0 0 0 ' + x1 + ' ' + (y + r) + 'V' + (y + hgt - r) + 'A' + r + ' ' + r + ' 0 0 0 ' + (x1 + r) + ' ' + (y + hgt) + 'H' + x0 + 'Z';
  }

  function BarChart(p) {
    var ref = React.useRef(null);
    var w = useWidth(ref, p.width || 640);
    var sc = p.scale || 1;
    var data = p.data || [];
    var fmt = p.format || function (v) { return formatNumber(v, { lang: langOf(p), decimals: 1 }); };
    var thick = Math.min(24 * sc, p.barThickness || 20 * sc), gap = 12 * sc;
    var labelW = (p.labelWidth || 120) * sc, valueW = 56 * sc;
    var vals = data.map(function (d) { return d.value; });
    var hasNeg = vals.some(function (v) { return v < 0; });
    var min = Math.min(0, Math.min.apply(null, vals)), max = Math.max(0, Math.max.apply(null, vals));
    var left = labelW + (hasNeg ? valueW : 0), right = w - valueW;
    var X = function (v) { return left + (v - min) / ((max - min) || 1) * (right - left); };
    var height = data.length * (thick + gap) + gap;
    var hs = React.useState(null), hover = hs[0], setHover = hs[1];
    function colorOf(d) {
      if (d.color) return seriesColor(d.color);
      if (p.highlight != null) return d.label === p.highlight ? 'var(--viz-focus)' : 'var(--viz-context)';
      if (p.diverging) return d.value < 0 ? 'var(--div-neg-2)' : 'var(--div-pos-2)';
      return seriesColor(p.color || 1);
    }
    return h('div', { ref: ref, className: cx('sn-chart', 'sn-barchart', p.className), style: { '--sc': sc } },
      h('svg', { width: w, height: height, viewBox: '0 0 ' + w + ' ' + height, role: 'img', 'aria-label': p.ariaLabel },
        data.map(function (d, i) {
          var y = gap + i * (thick + gap);
          var x0 = X(0), x1 = X(d.value);
          return h('g', { key: d.label, className: cx('sn-bar', hover === i && 'is-hover'), tabIndex: 0, 'aria-label': d.label + ': ' + fmt(d.value), onPointerEnter: function () { setHover(i); }, onPointerLeave: function () { setHover(null); }, onFocus: function () { setHover(i); }, onBlur: function () { setHover(null); } },
            h('rect', { x: 0, y: y - gap / 2, width: w, height: thick + gap, fill: 'transparent' }),
            h('text', { x: labelW - 12 * sc, y: y + thick / 2 + 4 * sc, textAnchor: 'end', className: 'sn-chart__cat' }, d.label),
            h('path', { d: barPath(x0, x1, y, thick, 2 * sc), style: { fill: colorOf(d) } }),
            h('text', { x: d.value < 0 ? x1 - 6 * sc : x1 + 6 * sc, y: y + thick / 2 + 4 * sc, textAnchor: d.value < 0 ? 'end' : 'start', className: 'sn-chart__value' }, fmt(d.value)));
        }),
        h('line', { x1: X(0), x2: X(0), y1: gap / 2, y2: height - gap / 2, className: 'sn-chart__zero' })));
  }

  function ChartCard(p) {
    var vs = React.useState('chart'), view = vs[0], setView = vs[1];
    var id = useId('sn-cc');
    var state = p.state || 'ready';
    var body;
    if (state === 'loading') body = h(Skeleton, { variant: 'chart', height: p.height });
    else if (state === 'empty') body = h(EmptyState, { title: p.emptyTitle || t(p, 'empty'), body: p.emptyBody, lang: p.lang });
    else if (state === 'error') body = h(Notice, { tone: 'critical', title: p.errorTitle, lang: p.lang }, p.errorMessage);
    else body = view === 'table' && p.table ? p.table : p.children;
    return h('section', { className: cx('sn-card', p.className), 'aria-labelledby': id, lang: p.lang },
      h('div', { className: 'sn-card__head' },
        h('div', null,
          h('h3', { className: 'sn-card__title', id: id }, p.title),
          p.subtitle ? h('p', { className: 'sn-card__sub' }, p.subtitle) : null),
        h('div', { className: 'sn-card__tools' },
          p.controls || null,
          p.table ? h(SegmentedControl, { size: 'sm', label: p.title, value: view, onChange: setView, options: [{ value: 'chart', label: t(p, 'chart') }, { value: 'table', label: t(p, 'table') }] }) : null)),
      p.legend && view === 'chart' && state === 'ready' ? h('div', { className: 'sn-card__legend' }, p.legend) : null,
      h('div', { className: cx('sn-card__body', state === 'refetching' && 'is-refetching'), 'aria-busy': state === 'refetching' || state === 'loading' ? true : undefined }, body),
      (p.source || p.updated || p.onDownload || p.footnote) ? h('div', { className: 'sn-card__foot' },
        h('p', { className: 'sn-card__source' },
          p.source ? t(p, 'source') + p.source : null,
          p.source && p.updated ? h('span', { className: 'sn-sep', 'aria-hidden': true }, '·') : null,
          p.updated ? t(p, 'updated') + ' ' + p.updated : null,
          p.footnote ? h('span', { className: 'sn-card__note' }, p.footnote) : null),
        p.onDownload ? h(Button, { variant: 'quiet', size: 'sm', icon: 'download', onClick: p.onDownload }, t(p, 'download')) : null) : null);
  }

  function DataTable(p) {
    var cols = p.columns || [];
    var ss = React.useState(p.defaultSort || null), sort = ss[0], setSort = ss[1];
    var rows = (p.rows || []).slice();
    if (sort) {
      rows.sort(function (a, b) {
        var x = a[sort.key], y = b[sort.key];
        var r = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), LOCALE[langOf(p)]);
        return sort.dir === 'desc' ? -r : r;
      });
    }
    function toggle(c) { setSort(sort && sort.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.align === 'right' ? 'desc' : 'asc' }); }
    return h('div', { className: cx('sn-table-wrap', p.className), lang: p.lang, tabIndex: 0, role: 'region', 'aria-label': p.caption },
      h('table', { className: cx('sn-table', p.dense && 'sn-table--dense') },
        p.caption ? h('caption', { className: p.showCaption ? 'sn-table__caption' : 'sn-visually-hidden' }, p.caption) : null,
        h('thead', null, h('tr', null, cols.map(function (c) {
          var active = sort && sort.key === c.key;
          return h('th', { key: c.key, scope: 'col', className: c.align === 'right' ? 'is-num' : undefined, style: c.width ? { width: c.width } : undefined, 'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : (c.sortable ? 'none' : undefined) },
            c.sortable ? h('button', { type: 'button', className: cx('sn-table__sort', active && 'is-active'), onClick: function () { toggle(c); } }, c.label, svgIcon(ICONS.sort)) : c.label);
        }))),
        h('tbody', null, rows.map(function (r, i) {
          return h('tr', { key: r.id || i }, cols.map(function (c, j) {
            var v = r[c.key];
            var content = c.render ? c.render(v, r) : (typeof v === 'number' ? formatNumber(v, { lang: langOf(p), decimals: c.decimals != null ? c.decimals : 2 }) : v);
            return j === 0 ? h('th', { key: c.key, scope: 'row', className: c.align === 'right' ? 'is-num' : undefined }, content) : h('td', { key: c.key, className: c.align === 'right' ? 'is-num' : undefined }, content);
          }));
        }))));
  }

  /* =====================================================================
     Feedback
     ===================================================================== */
  function Notice(p) {
    var tone = p.tone || 'info';
    return h('div', { className: cx('sn-notice', 'sn-notice--' + tone, p.className), role: tone === 'critical' ? 'alert' : 'status', lang: p.lang },
      h('span', { className: 'sn-notice__icon' }, svgIcon(ICONS[tone] || ICONS.info)),
      h('div', null,
        p.title ? h('p', { className: 'sn-notice__title' }, p.title) : null,
        p.children ? h('div', { className: 'sn-notice__body' }, p.children) : null,
        p.action || null));
  }

  function Skeleton(p) {
    var v = p.variant || 'text';
    if (v === 'chart') return h('div', { className: 'sn-skel sn-skel--chart', style: { height: (p.height || 320) + 'px' }, 'aria-label': t(p, 'loading'), role: 'status' }, [0, 1, 2, 3].map(function (i) { return h('span', { key: i }); }));
    if (v === 'tile') return h('div', { className: 'sn-skel sn-skel--tile', role: 'status', 'aria-label': t(p, 'loading') }, h('span'), h('span'), h('span'));
    var n = p.lines || 3, out = [];
    for (var i = 0; i < n; i++) out.push(h('span', { key: i, style: { width: i === n - 1 ? '60%' : '100%' } }));
    return h('div', { className: 'sn-skel sn-skel--text', role: 'status', 'aria-label': t(p, 'loading') }, out);
  }

  function EmptyState(p) {
    return h('div', { className: cx('sn-empty', p.className), lang: p.lang },
      h('div', { className: 'sn-empty__mark', 'aria-hidden': true }, h('span'), h('span'), h('span')),
      h('p', { className: 'sn-empty__title' }, p.title || t(p, 'empty')),
      p.body ? h('p', { className: 'sn-empty__body' }, p.body) : null,
      p.action || null);
  }

  /* =====================================================================
     Infographics
     ===================================================================== */
  function InfographicFrame(p) {
    var format = p.format || 'portrait';
    var theme = p.theme || 'concrete';
    return h('div', { className: cx('sn-info', 'sn-info--' + format, 'sn-info--' + theme, p.className), lang: p.lang },
      h('svg', { className: 'sn-info__mark', viewBox: '0 0 240 36', 'aria-hidden': true, focusable: 'false' },
        h('rect', { x: 0, y: 14, width: 56, height: 8 }), h('rect', { x: 92, y: 14, width: 56, height: 8 }), h('rect', { x: 184, y: 14, width: 56, height: 8 })),
      h('div', { className: 'sn-info__inner' },
        h('div', { className: 'sn-info__head' },
          p.kicker ? h('p', { className: 'sn-info__kicker' }, p.kicker) : null,
          h('h2', { className: 'sn-info__title' }, p.title),
          p.subtitle ? h('p', { className: 'sn-info__sub' }, p.subtitle) : null),
        h('div', { className: 'sn-info__body' }, p.children),
        h('div', { className: 'sn-info__foot' },
          h('div', null,
            p.source ? h('p', { className: 'sn-info__source' }, t(p, 'source') + p.source) : null,
            h('p', { className: 'sn-info__brand' }, p.name || 'Sinho')),
          p.tag ? h('p', { className: 'sn-info__tag' }, p.tag) : null)));
  }

  /* =====================================================================
     Ticker — the departure board
     ===================================================================== */
  function Ticker(p) {
    var items = p.items || [];
    var dur = p.duration || Math.max(24, items.length * 6);
    function row(dup) {
      return h('ul', { className: 'sn-ticker__row', 'aria-hidden': dup ? true : undefined },
        items.map(function (it, i) {
          return h('li', { key: i, className: 'sn-ticker__item' },
            h('span', { className: 'sn-ticker__label' }, it.label),
            h('span', { className: 'sn-ticker__value' }, minus(it.value)),
            it.unit ? h('span', { className: 'sn-ticker__unit' }, it.unit) : null,
            it.delta ? h(Delta, Object.assign({ lang: p.lang }, it.delta)) : null);
        }));
    }
    return h('section', { className: cx('sn-ticker', p.static && 'sn-ticker--static', p.className), 'aria-label': p.label || p.title || t(p, 'live'), lang: p.lang, 'data-market': p.market },
      h('p', { className: 'sn-ticker__title' }, h('span', { className: 'sn-ticker__dot', 'aria-hidden': true }), p.title || t(p, 'live')),
      h('div', { className: 'sn-ticker__viewport' },
        h('div', { className: 'sn-ticker__track', style: { animationDuration: dur + 's' } }, row(false), p.static ? null : row(true))));
  }

  var api = {
    Masthead: Masthead, LanguageSwitch: LanguageSwitch, Tabs: Tabs, Footer: Footer,
    Button: Button, SubscribeBox: SubscribeBox, TextField: TextField, Select: Select, SegmentedControl: SegmentedControl, Switch: Switch, Checkbox: Checkbox,
    Tag: Tag, StoryCard: StoryCard, IssueHero: IssueHero, ArticleHeader: ArticleHeader, Figure: Figure, LaneRule: LaneRule, Insight: Insight,
    PaperCard: PaperCard, KeyFindings: KeyFindings,
    StatTile: StatTile, Delta: Delta, Sparkline: Sparkline, LineChart: LineChart, BarChart: BarChart, Legend: Legend, ChartTooltip: ChartTooltip, ChartCard: ChartCard, DataTable: DataTable,
    Notice: Notice, Skeleton: Skeleton, EmptyState: EmptyState, InfographicFrame: InfographicFrame, Ticker: Ticker,
    strings: STRINGS, format: { number: formatNumber, date: formatDate, minus: minus }
  };
  window.Sinho = Object.assign(window.Sinho || {}, api);
})();
