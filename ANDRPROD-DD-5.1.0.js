(function () {
'use strict';

/*
 ANDRPROD DD 5.1.0
 Independent one-button Lampac source aggregator for Lampa.
 Workflow: discover server -> read /lite/events -> request every balancer
 with title metadata -> normalize/merge links -> offer one combined list.
 Provider formats differ; unknown responses are not presented as playable.
*/
if (window.andrprod_dd_510_ready) return;
window.andrprod_dd_510_ready = true;

var VERSION = '5.1.0', NAME = 'ANDRPROD DD';
var SETTINGS_KEY = 'andrprod_dd_510_settings', DEBUG_KEY = 'andrprod_dd_510_debug';
var BASE = '', lastReport = null, TIMEOUT = 18000, PARALLEL = 12;

function log(message, data) {
    try {
        var a = Lampa.Storage.get(DEBUG_KEY, []) || [];
        a.unshift({at: Date.now(), message: message, data: data || null});
        Lampa.Storage.set(DEBUG_KEY, a.slice(0, 80));
    } catch (e) {}
    try { console.log('[ANDRPROD DD]', message, data || ''); } catch (e) {}
}
function settings() {
    var s = {server: '', timeout: TIMEOUT, enabled: {}, sort: 'source'};
    try {
        var v = Lampa.Storage.get(SETTINGS_KEY, {}) || {};
        Object.keys(v).forEach(function (k) { s[k] = v[k]; });
    } catch (e) {}
    return s;
}
function enc(v) { return encodeURIComponent(v == null ? '' : String(v)); }
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function clean(v) { return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function origin(u) {
    var m = String(u || '').match(/^(https?:\/\/[^\/?#]+)/i);
    return m ? m[1] : '';
}
function normalizeBase(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v.replace(/\/+$/, '').replace(/\/lite$/i, '');
}
function request(url, timeout) {
    timeout = timeout || TIMEOUT;
    return new Promise(function (resolve, reject) {
        var ended = false, timer = setTimeout(function () { finish(false, new Error('timeout')); }, timeout);
        function finish(ok, value) {
            if (ended) return;
            ended = true; clearTimeout(timer);
            if (ok) resolve(value); else reject(value instanceof Error ? value : new Error(String(value || 'request failed')));
        }
        if (window.fetch) {
            fetch(url, {method: 'GET', credentials: 'omit'}).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            }).then(function (t) {
                try { finish(true, JSON.parse(t)); } catch (e) { finish(true, t); }
            }).catch(function (e) { finish(false, e); });
        } else {
            try {
                var x = new XMLHttpRequest();
                x.open('GET', url, true); x.timeout = timeout;
                x.onreadystatechange = function () {
                    if (x.readyState !== 4) return;
                    if (x.status < 200 || x.status >= 300) return finish(false, new Error('HTTP ' + x.status));
                    try { finish(true, JSON.parse(x.responseText)); } catch (e) { finish(true, x.responseText); }
                };
                x.onerror = function () { finish(false, new Error('network error')); };
                x.ontimeout = function () { finish(false, new Error('timeout')); };
                x.send();
            } catch (e) { finish(false, e); }
        }
    });
}
function discoverServer() {
    var s = settings(), candidates = [];
    if (s.server) candidates.push(normalizeBase(s.server));
    try { var so = origin(document.currentScript && document.currentScript.src); if (so) candidates.push(so); } catch (e) {}
    try { var po = origin(window.location.href); if (po) candidates.push(po); } catch (e) {}
    candidates = candidates.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    return candidates.reduce(function (p, base) {
        return p.then(function (found) {
            if (found) return found;
            return request(base + '/lite/events?rjson=true', 5000).then(function (j) {
                return (Array.isArray(j) || (j && Array.isArray(j.online))) ? base : '';
            }).catch(function () { return ''; });
        });
    }, Promise.resolve('')).then(function (base) {
        if (!base) throw new Error('Lampac-сервер не найден. Укажи адрес в настройках ANDRPROD DD.');
        BASE = base; return base;
    });
}
function balancers(data) {
    var list = Array.isArray(data) ? data : arr(data && data.online);
    return list.map(function (e) {
        if (!isObj(e) || e.service === true) return null;
        var name = e.balanser || e.name || e.title, url = e.url;
        if (!name || !url) return null;
        if (!/^https?:\/\//i.test(url)) {
            if (url.charAt(0) !== '/') url = '/lite/' + url;
            url = BASE + url;
        }
        return {id: String(name).toLowerCase(), name: String(name), url: url};
    }).filter(Boolean);
}
function serial(card) {
    return !!(card && (card.name || card.number_of_seasons || card.seasons || card.first_air_date) &&
        !(card.title && !card.name && !card.number_of_seasons));
}
function query(card) {
    var q = ['id=' + enc(card.id || card.tmdb_id || '')];
    if (card.imdb_id) q.push('imdb_id=' + enc(card.imdb_id));
    if (card.kinopoisk_id) q.push('kinopoisk_id=' + enc(card.kinopoisk_id));
    if (card.tmdb_id) q.push('tmdb_id=' + enc(card.tmdb_id));
    q.push('title=' + enc(card.title || card.name || ''));
    q.push('original_title=' + enc(card.original_title || card.original_name || ''));
    q.push('serial=' + (serial(card) ? 1 : 0));
    q.push('original_language=' + enc(card.original_language || ''));
    q.push('year=' + enc((card.release_date || card.first_air_date || '').slice(0, 4)));
    q.push('source=' + enc(card.source || 'tmdb'));
    q.push('clarification=0'); q.push('similar=false');
    return q.join('&');
}
function maybeJson(v) {
    if (isObj(v) || Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) {} }
    return null;
}
function decodeHtml(v) {
    return String(v || '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function normalize(item, source) {
    if (!item || !item.url) return null;
    var u = String(item.url).trim();
    if (/^\/\//.test(u)) u = 'https:' + u;
    if (/^\//.test(u)) u = BASE + u;
    return {url: u, title: clean(item.title || item.voice || item.quality || source.name),
        voice: clean(item.voice || item.translation || item.title || ''),
        quality: clean(item.quality || item.resolution || ''), source: source.name,
        sourceId: source.id, headers: item.headers || item.header || null,
        method: item.method || '', raw: item.raw || null};
}
function collect(data, source, out, depth) {
    if (depth > 7 || data == null) return;
    var o = maybeJson(data);
    if (o == null && typeof data === 'string') {
        var re = /(?:data-json|data-json-data)\s*=\s*(['"])(.*?)\1/gi, m;
        while ((m = re.exec(data))) {
            var j = maybeJson(decodeHtml(m[2]));
            if (j) collect(j, source, out, depth + 1);
        }
        var tags = /<[^>]*class=["'][^"']*videos__item[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi;
        while ((m = tags.exec(data))) {
            var href = m[0].match(/(?:href|data-url|src)=["']([^"']+)["']/i);
            if (href) { var c = normalize({url: decodeHtml(href[1]), title: clean(m[0])}, source); if (c) out.push(c); }
        }
        return;
    }
    if (Array.isArray(o)) { o.forEach(function (v) { collect(v, source, out, depth + 1); }); return; }
    if (!isObj(o)) return;
    var u = o.url || o.file || o.link || o.stream || o.play || o.hls || o.m3u8;
    if (typeof u === 'string' && u) {
        var c = normalize({url: u, title: o.title || o.name || o.voice || o.translation || '',
            voice: o.voice || o.translation || o.translate || o.author || o.studio || '',
            quality: o.quality || o.max_quality || o.resolution || '',
            headers: o.headers || o.header, method: o.method, raw: o}, source);
        if (c) out.push(c);
    }
    ['online','results','data','items','videos','playlist','balancers','voices','translations','files','list'].forEach(function (k) {
        if (o[k] != null && o[k] !== u) collect(o[k], source, out, depth + 1);
    });
}
function playable(u) {
    return /^https?:\/\//i.test(u) && !/\.(html?|php)(?:[?#]|$)/i.test(u);
}
function ask(source, card) {
    var url = source.url + (source.url.indexOf('?') >= 0 ? '&' : '?') + query(card), started = Date.now();
    return request(url, settings().timeout).then(function (data) {
        var found = []; collect(data, source, found, 0);
        found = found.filter(function (v) { return v && playable(v.url); });
        return {source: source.name, ok: true, ms: Date.now() - started, count: found.length, items: found};
    }).catch(function (e) {
        return {source: source.name, ok: false, ms: Date.now() - started, count: 0, error: e.message, items: []};
    });
}
function mapLimit(list, limit, fn) {
    var index = 0, active = 0, result = [];
    return new Promise(function (resolve) {
        function next() {
            if (index >= list.length && active === 0) return resolve(result);
            while (active < limit && index < list.length) (function (i) {
                active++;
                fn(list[i]).then(function (v) { result[i] = v; active--; next(); });
            })(index++);
        }
        next();
    });
}
function qualityScore(q) {
    q = String(q || '').toLowerCase();
    if (/2160|4k|uhd/.test(q)) return 4;
    if (/1080|full.?hd/.test(q)) return 3;
    if (/720|hd/.test(q)) return 2;
    if (/480|sd/.test(q)) return 1;
    return 0;
}
function search(card) {
    var report = {version: VERSION, server: '', started: Date.now(), sources: [], results: []};
    return discoverServer().then(function (base) {
        report.server = base;
        return request(base + '/lite/events?rjson=true', 7000);
    }).then(function (events) {
        var list = balancers(events), s = settings();
        list = list.filter(function (b) { return s.enabled[b.id] !== false; });
        report.discovered = list.length;
        if (!list.length) throw new Error('Сервер найден, но список источников пуст.');
        return mapLimit(list, PARALLEL, function (src) { return ask(src, card); });
    }).then(function (answers) {
        answers.forEach(function (a) {
            report.sources.push({source:a.source, ok:a.ok, ms:a.ms, count:a.count, error:a.error || ''});
            report.results = report.results.concat(a.items || []);
        });
        var seen = {};
        report.results = report.results.filter(function (x) {
            if (!x || !x.url) return false;
            var k = x.url.replace(/[?&](token|expires|sign)=[^&]*/ig, '');
            if (seen[k]) return false; seen[k] = true; return true;
        });
        if (settings().sort === 'quality') report.results.sort(function (a,b) { return qualityScore(b.quality)-qualityScore(a.quality); });
        report.duration = Date.now() - report.started; lastReport = report;
        log('search complete', {sources:report.discovered, results:report.results.length, duration:report.duration});
        return report;
    });
}
function play(item, card) {
    var data = {title:(card.title || card.name || 'Видео') + (item.voice ? ' · ' + item.voice : ''),
        url:item.url, quality:item.quality || '', source:item.source, isonline:true, card:card};
    if (item.headers) data.headers = item.headers;
    if (item.method) data.method = item.method;
    try { Lampa.Player.play(data); }
    catch (e) { log('play error', e.message); Lampa.Noty.show('Ошибка запуска потока: ' + e.message); }
}
function diagnostics(report) {
    var items = [{title:'Версия ' + VERSION, subtitle:'Сервер: ' + (report.server || 'не найден')},
        {title:'Всего результатов: ' + (report.results || []).length, subtitle:'Источников: ' + (report.sources || []).length}];
    (report.sources || []).forEach(function (s) {
        items.push({title:(s.ok ? '✓ ' : '✕ ') + s.source + ' · ' + s.count,
            subtitle:s.ms + ' мс' + (s.error ? ' · ' + s.error : '')});
    });
    Lampa.Select.show({title:NAME + ' · Диагностика', items:items, onSelect:function () {}});
}
function show(report, card) {
    var items = (report.results || []).map(function (r, i) {
        return {title:(r.voice || r.title || ('Вариант ' + (i+1))) + (r.quality ? ' · ' + r.quality : ''),
            subtitle:r.source, item:r};
    });
    if (!items.length) items.push({title:'Ничего не найдено', subtitle:'Проверь диагностику источников.'});
    items.push({title:'Диагностика источников', diagnostic:true});
    Lampa.Select.show({title:NAME + ' · ' + (card.title || card.name || ''),
        items:items, onSelect:function (v) {
            if (v && v.item) play(v.item, card);
            else if (v && v.diagnostic) diagnostics(report);
        }});
}
function start(card) {
    if (!card) return;
    Lampa.Noty.show(NAME + ': опрашиваю источники…');
    search(card).then(function (r) { show(r, card); }).catch(function (e) {
        log('search failed', e.message); Lampa.Noty.show(NAME + ': ' + e.message);
    });
}
function addButton() {
    if (!Lampa.Listener) return;
    Lampa.Listener.follow('full', function (e) {
        if (!e || e.type !== 'complite' || !e.object || !e.data) return;
        var card = e.data.movie || e.data;
        var render = e.object.activity && e.object.activity.render ? e.object.activity.render() : null;
        if (!render) return;
        var root = render.querySelector('.full-start__buttons');
        if (!root || root.querySelector('.andrprod-dd-510')) return;
        var b = document.createElement('div');
        b.className = 'full-start__button selector andrprod-dd-510';
        b.innerHTML = '<span>ANDRPROD DD</span>';
        b.addEventListener('hover:enter', function () { start(card); });
        b.addEventListener('click', function () { start(card); });
        root.appendChild(b);
    });
}
function boot() {
    addButton();
    log('loaded', {version:VERSION});
}
if (window.Lampa && Lampa.Listener) {
    if (Lampa.Manifest && Lampa.Manifest.plugins) boot();
    else Lampa.Listener.follow('app', function (e) { if (e && e.type === 'ready') boot(); });
}
window.ANDRPROD_DD = {version:VERSION, search:search, diagnostics:function(){return lastReport;}};
})();