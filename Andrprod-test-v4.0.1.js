(function () {
    'use strict';

    /**
     * ANDRPROD DD v4.0.1 — Единый агрегатор онлайн-источников для Lampa
     * Совместимость: Android, Android TV, Tizen, webOS, Desktop WebView (строгий ES5)
     *
     * Архитектура:
     * 1.  Diagnostics           — статус загрузки/инициализации, журнал ошибок, проверка всех источников.
     * 2.  BrandIcons            — прозрачный логотип ANDRPROD DD (без рамки и подложки) и иконки источников.
     * 3.  StorageManager        — хранение всех настроек в Lampa.Storage (источники, языки, min/max качество, поиск).
     * 4.  TitleResolver         — извлечение метаданных фильма/сериала (TMDB/IMDB/KP ID, названия, постер, год).
     * 5.  AdapterFactory        — модульная система адаптеров (getSourceInfo, isAvailable, searchMovie, searchSeries, getStreams, play).
     * 6.  SourceRegistry        — белый список онлайн-кинотеатров + внешние адаптеры через window.ANDRPROD_API.
     * 7.  FilterEngine          — фильтрация по языкам (UA/RU/EN/другие), min/max качеству, озвучке, HDR/DV, сортировка.
     * 8.  BestChoiceEngine      — взвешенный выбор лучшего подтверждённого варианта.
     * 9.  UnifiedSearchEngine   — параллельный поиск с отменой (net.clear), 1 ретраем при ошибке, дедупликацией и кешем SearchCache.
     * 10. CardIntegration       — кнопка ANDRPROD DD в карточке фильма/сериала + безопасный запуск живых кнопок (фикс повторного нажатия).
     * 11. AndrprodSearchComponent — главный экран агрегатора (постер, метаданные, статусы, 50+ результатов, прокрутка, пульт ТВ).
     * 12. AndrprodHubComponent  — «Выбрать источники» и «Диагностика» с кнопкой «Проверить все источники».
     * 13. SettingsIntegration   — полный раздел Lampa → Настройки → ANDRPROD DD (Lampa.SettingsApi).
     */

    if (window.andrprod_dd_ready) return;

    var PLUGIN_ID = 'andrprod_dd';
    var PLUGIN_NAME = 'ANDRPROD DD';
    var PLUGIN_VERSION = '4.0.1';
    var HUB_COMPONENT = 'andrprod_hub';
    var SEARCH_COMPONENT = 'andrprod_search';

    // =========================================================================
    // 1. ДИАГНОСТИКА И ЛОГИРОВАНИЕ (Diagnostics)
    // =========================================================================
    var Diagnostics = {
        loaded: false,
        initialized: false,
        manifestRegistered: false,
        componentsRegistered: { hub: false, search: false },
        cardIntegrationActive: false,
        lastCardEventAt: 0,
        lastSearchAt: 0,
        lastSearchDurationMs: 0,
        lastResultCount: 0,
        unsupportedPlugins: [],
        lastCheckResults: {}, // sourceId -> { name, ok, status, latency, message, checkedAt }
        errors: [],

        logError: function (moduleName, err) {
            var msg = err && err.message ? err.message : String(err || 'Неизвестная ошибка');
            Diagnostics.errors.unshift({
                time: formatTime(Date.now()),
                module: moduleName || 'Core',
                message: msg
            });
            if (Diagnostics.errors.length > 50) Diagnostics.errors.length = 50;
            try {
                if (window.console && typeof console.error === 'function') {
                    console.error('[ANDRPROD DD:' + moduleName + ']', msg);
                }
            } catch (e) {}
        },

        getReport: function () {
            var adapters = SourceRegistry.getAdapters();
            var activeCount = 0;
            var i;
            for (i = 0; i < adapters.length; i++) {
                if (StorageManager.isSourceEnabled(adapters[i].getSourceInfo().id)) activeCount++;
            }
            return {
                version: PLUGIN_VERSION,
                loaded: Diagnostics.loaded,
                initialized: Diagnostics.initialized,
                manifestRegistered: Diagnostics.manifestRegistered,
                hubRegistered: Diagnostics.componentsRegistered.hub,
                searchRegistered: Diagnostics.componentsRegistered.search,
                cardIntegrationActive: Diagnostics.cardIntegrationActive,
                discoveredCount: adapters.length,
                activeCount: activeCount,
                unsupportedCount: Diagnostics.unsupportedPlugins.length,
                unsupportedPlugins: Diagnostics.unsupportedPlugins,
                lastSearchAt: Diagnostics.lastSearchAt,
                lastSearchDurationMs: Diagnostics.lastSearchDurationMs,
                lastResultCount: Diagnostics.lastResultCount,
                lastError: Diagnostics.errors.length ? Diagnostics.errors[0] : null,
                errors: Diagnostics.errors,
                lastCheckResults: Diagnostics.lastCheckResults
            };
        }
    };

    // =========================================================================
    // 2. ПРОЗРАЧНЫЙ ЛОГОТИП ANDRPROD DD И ИКОНКИ (BrandIcons)
    // =========================================================================
    var BrandIcons = {
        getLogoSvg: function (className, uid) {
            var gradId = 'andrprod_dd_grad_' + (uid || 'main');
            return (
                '<svg class="andrprod-logo-svg ' + (className || '') + '" viewBox="0 0 420 58" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-label="ANDRPROD DD" role="img">' +
                    '<defs>' +
                        '<linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
                            '<stop offset="0%" stop-color="#7DD3FC"/>' +
                            '<stop offset="48%" stop-color="#38BDF8"/>' +
                            '<stop offset="100%" stop-color="#2563EB"/>' +
                        '</linearGradient>' +
                    '</defs>' +
                    '<text x="210" y="44" text-anchor="middle" fill="url(#' + gradId + ')" ' +
                        'text-rendering="geometricPrecision" ' +
                        'font-family="\'Segoe UI\', \'Roboto\', \'Helvetica Neue\', Arial, sans-serif" ' +
                        'font-size="42" font-weight="900" letter-spacing="3.5">ANDRPROD DD</text>' +
                '</svg>'
            );
        },

        getMiniIconSvg: function () {
            return (
                '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">' +
                    '<path d="M4 18L10.5 5H13.5L20 18H16.8L15.4 15H8.6L7.2 18H4ZM9.7 12.4H14.3L12 7.5L9.7 12.4Z" fill="#38BDF8"/>' +
                '</svg>'
            );
        }
    };

    // =========================================================================
    // 3. ХРАНИЛИЩЕ НАСТРОЕК В LAMPA (StorageManager)
    // =========================================================================
    var STORAGE_KEYS = {
        searchMode: 'andrprod_dd_search_mode',         // 'auto' | 'manual' | 'best'
        timeoutMs: 'andrprod_dd_timeout_ms',           // 3000 | 6000 | 9000 | 12000
        retryOnError: 'andrprod_dd_retry_on_error',    // true | false
        showProgress: 'andrprod_dd_show_progress',     // true | false
        langUk: 'andrprod_dd_lang_uk',                 // true | false
        langRu: 'andrprod_dd_lang_ru',                 // true | false
        langEn: 'andrprod_dd_lang_en',                 // true | false
        langOther: 'andrprod_dd_lang_other',           // true | false
        minQuality: 'andrprod_dd_min_quality',         // 'any' | '480p' | '720p' | '1080p' | '2160p' | '4k'
        maxQuality: 'andrprod_dd_max_quality',         // 'any' | '4k' | '2160p' | '1080p' | '720p' | '480p'
        prefVoice: 'andrprod_dd_pref_voice',           // 'any' | 'dub' | 'multi' | 'orig'
        hideUnavailable: 'andrprod_dd_hide_unavail',   // true | false
        hideUnmatched: 'andrprod_dd_hide_unmatched',   // true | false
        sortBy: 'andrprod_dd_sort_by',                 // 'priority' | 'quality' | 'speed' | 'name'
        disabledSources: 'andrprod_dd_disabled_src',   // { sourceId: true }
        priorities: 'andrprod_dd_priorities'           // [sourceId1, sourceId2, ...]
    };

    var StorageManager = {
        get: function (key, defVal) {
            try {
                if (!window.Lampa || !Lampa.Storage || typeof Lampa.Storage.get !== 'function') return defVal;
                var val = Lampa.Storage.get(key, defVal);
                return typeof val === 'undefined' || val === null ? defVal : val;
            } catch (e) {
                Diagnostics.logError('StorageManager.get', e);
                return defVal;
            }
        },
        set: function (key, val) {
            try {
                if (!window.Lampa || !Lampa.Storage || typeof Lampa.Storage.set !== 'function') return;
                Lampa.Storage.set(key, val);
            } catch (e) {
                Diagnostics.logError('StorageManager.set', e);
            }
        },
        getBool: function (key, defVal) {
            var v = StorageManager.get(key, defVal);
            if (typeof v === 'boolean') return v;
            if (v === 'true' || v === 1 || v === '1') return true;
            if (v === 'false' || v === 0 || v === '0') return false;
            return !!defVal;
        },
        getSearchMode: function () {
            var m = StorageManager.get(STORAGE_KEYS.searchMode, 'auto');
            return (m === 'manual' || m === 'best' || m === 'auto') ? m : 'auto';
        },
        setSearchMode: function (m) {
            StorageManager.set(STORAGE_KEYS.searchMode, (m === 'manual' || m === 'best') ? m : 'auto');
        },
        getTimeoutMs: function () {
            var t = parseInt(StorageManager.get(STORAGE_KEYS.timeoutMs, 6000), 10);
            if (isNaN(t) || t < 2000 || t > 20000) return 6000;
            return t;
        },
        isRetryOnError: function () { return StorageManager.getBool(STORAGE_KEYS.retryOnError, true); },
        isShowProgress: function () { return StorageManager.getBool(STORAGE_KEYS.showProgress, true); },
        getAllowedLanguages: function () {
            return {
                uk: StorageManager.getBool(STORAGE_KEYS.langUk, true),
                ru: StorageManager.getBool(STORAGE_KEYS.langRu, true),
                en: StorageManager.getBool(STORAGE_KEYS.langEn, true),
                other: StorageManager.getBool(STORAGE_KEYS.langOther, true)
            };
        },
        getMinQuality: function () { return String(StorageManager.get(STORAGE_KEYS.minQuality, 'any') || 'any'); },
        getMaxQuality: function () { return String(StorageManager.get(STORAGE_KEYS.maxQuality, 'any') || 'any'); },
        getPrefVoice: function () { return String(StorageManager.get(STORAGE_KEYS.prefVoice, 'any') || 'any'); },
        isHideUnavailable: function () { return StorageManager.getBool(STORAGE_KEYS.hideUnavailable, false); },
        isHideUnmatched: function () { return StorageManager.getBool(STORAGE_KEYS.hideUnmatched, true); },
        getSortBy: function () { return String(StorageManager.get(STORAGE_KEYS.sortBy, 'priority') || 'priority'); },
        getDisabledMap: function () {
            var m = StorageManager.get(STORAGE_KEYS.disabledSources, {});
            return m && typeof m === 'object' ? m : {};
        },
        isSourceEnabled: function (id) { return !StorageManager.getDisabledMap()[id]; },
        setSourceEnabled: function (id, enabled) {
            var m = StorageManager.getDisabledMap();
            if (enabled) delete m[id];
            else m[id] = true;
            StorageManager.set(STORAGE_KEYS.disabledSources, m);
        },
        getPriorities: function () {
            var arr = StorageManager.get(STORAGE_KEYS.priorities, []);
            return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
        },
        setPriorities: function (arr) { StorageManager.set(STORAGE_KEYS.priorities, arr || []); },
        movePriority: function (sourceId, direction) {
            var adapters = SourceRegistry.getAdapters();
            var ids = [];
            var i;
            for (i = 0; i < adapters.length; i++) ids.push(adapters[i].getSourceInfo().id);
            var idx = ids.indexOf(sourceId);
            if (idx === -1) return false;
            var target = idx + direction;
            if (target < 0 || target >= ids.length) return false;
            var tmp = ids[idx];
            ids[idx] = ids[target];
            ids[target] = tmp;
            StorageManager.setPriorities(ids);
            return true;
        }
    };

    // =========================================================================
    // 4. МЕТАДАННЫЕ ФИЛЬМА / СЕРИАЛА (TitleResolver)
    // =========================================================================
    var TitleResolver = {
        extractMediaMeta: function (card, explicitMethod) {
            card = card || {};
            var isSeries = TitleResolver.detectIsSeries(card, explicitMethod);
            var localizedTitle = isSeries ? safeTrim(card.name || card.title) : safeTrim(card.title || card.name);
            var originalTitle = isSeries ? safeTrim(card.original_name || card.original_title) : safeTrim(card.original_title || card.original_name);
            var rawDate = String(isSeries ? (card.first_air_date || card.release_date || card.year || '') : (card.release_date || card.first_air_date || card.year || ''));
            var ym = rawDate.match(/\d{4}/);
            var year = ym ? ym[0] : '';

            var poster = '';
            try {
                if (card.poster_path && window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.image === 'function') {
                    poster = Lampa.TMDB.image('t/p/w300' + card.poster_path);
                } else if (card.img) {
                    poster = card.img;
                }
            } catch (eImg) {
                poster = card.img || '';
            }

            var meta = {
                id: card.id || '',
                tmdbId: card.id || '',
                imdbId: card.imdb_id || '',
                kinopoiskId: card.kinopoisk_id || card.kp_id || '',
                mediaType: isSeries ? 'series' : 'movie',
                isSeries: isSeries,
                title: localizedTitle || originalTitle || 'Без названия',
                localizedTitle: localizedTitle,
                originalTitle: originalTitle,
                year: year,
                poster: poster,
                rating: card.vote_average ? Number(card.vote_average).toFixed(1) : '',
                numberOfSeasons: card.number_of_seasons || (card.seasons && card.seasons.length ? card.seasons.length : 0),
                originalLanguage: String(card.original_language || '').toLowerCase(),
                rawCard: card
            };
            meta.queryVariants = TitleResolver.buildQueryVariants(meta);
            return meta;
        },

        detectIsSeries: function (card, explicitMethod) {
            if (explicitMethod === 'tv' || explicitMethod === 'series') return true;
            if (explicitMethod === 'movie') return false;
            if (card.first_air_date || card.number_of_seasons || card.original_name || card.media_type === 'tv') return true;
            if (card.name && !card.title) return true;
            return false;
        },

        buildQueryVariants: function (meta) {
            var out = [];
            var seen = {};
            function add(q) {
                var clean = safeTrim(String(q || '').replace(/\s+/g, ' '));
                if (!clean) return;
                var low = clean.toLowerCase();
                if (!seen[low]) { seen[low] = true; out.push(clean); }
            }
            add(meta.localizedTitle);
            add(meta.originalTitle);
            if (meta.year && meta.localizedTitle) add(meta.localizedTitle + ' ' + meta.year);
            if (meta.year && meta.originalTitle) add(meta.originalTitle + ' ' + meta.year);
            return out;
        }
    };

    // =========================================================================
    // 5. БЕЛЫЙ СПИСОК ОНЛАЙН-КИНОТЕАТРОВ И ЧЁРНЫЙ СПИСОК
    // =========================================================================
    var NON_ONLINE_BLACKLIST = [
        'theme', 'skin', 'style', 'css', 'ui', 'interface', 'design', 'logo', 'icon',
        'rating', 'kp_rating', 'imdb', 'shots', 'tracks', 'subtitle', 'trailer',
        'torrserver', 'torrent', 'jacred', 'parser', 'tmdb_proxy', 'proxy', 'cub',
        'adblock', 'advert', 'menu', 'background', 'backdrop', 'cardify', 'easymode',
        'collection', 'recommend', 'myshows', 'shikimori', 'calendar', 'history', 'sync'
    ];

    var ONLINE_PLUGIN_WHITELIST = [
        { id: 'lampac', name: 'Lampac', kind: 'lampac_protocol', patterns: ['lampac', '/online.js', 'online_prestige', 'lampa.mx', 'smotret24', 'jin.energy', 'newonline.js'], buttonHints: ['online_prestige', 'lampac', 'онлайн', 'online'] },
        { id: 'bwa', name: 'BWA', kind: 'lampac_protocol', patterns: ['bwa.to', '/bwa', 'rc.bwa', 'bwa.js'], buttonHints: ['bwa'] },
        { id: 'uaflix', name: 'UAFlix', kind: 'lampac_or_native', patterns: ['uaflix'], buttonHints: ['uaflix'] },
        { id: 'uafilm', name: 'UAFilm', kind: 'lampac_or_native', patterns: ['uafilm'], buttonHints: ['uafilm'] },
        { id: 'line_prime', name: 'Line Prime', kind: 'lampac_or_native', patterns: ['lineprime', 'line_prime', 'line-prime'], buttonHints: ['line prime', 'lineprime'] },
        { id: 'online_mod', name: 'Online Mod', kind: 'online_mod', patterns: ['online_mod', 'nb557'], buttonHints: ['online_mod', 'онлайн мод', 'online mod', 'lampac--button', 'view--online', 'онлайн'] },
        { id: 'alpaca', name: 'Alpaca', kind: 'lampac_or_native', patterns: ['alpaca'], buttonHints: ['alpaca'] },
        { id: 'lumio', name: 'Lumio', kind: 'lampac_or_native', patterns: ['lumio'], buttonHints: ['lumio'] },
        { id: 'showy', name: 'Showy', kind: 'lampac_or_native', patterns: ['showy'], buttonHints: ['showy'] },
        { id: 'hdrezka', name: 'HDRezka', kind: 'native_only', patterns: ['hdrezka', 'rezka.js', '/rezka'], buttonHints: ['hdrezka', 'rezka', 'резка'] },
        { id: 'kinopub', name: 'KinoPub', kind: 'native_only', patterns: ['kinopub', 'kpub'], buttonHints: ['kinopub', 'кинопаб'] },
        { id: 'filmix', name: 'Filmix', kind: 'native_only', patterns: ['filmix'], buttonHints: ['filmix', 'филмикс'] },
        { id: 'kodik', name: 'Kodik', kind: 'native_only', patterns: ['kodik'], buttonHints: ['kodik', 'кодик'] },
        { id: 'ashdi', name: 'Ashdi', kind: 'native_only', patterns: ['ashdi'], buttonHints: ['ashdi'] },
        { id: 'eneyida', name: 'Eneyida', kind: 'native_only', patterns: ['eneyida'], buttonHints: ['eneyida'] },
        { id: 'uakino', name: 'UAKino', kind: 'native_only', patterns: ['uakino'], buttonHints: ['uakino'] }
    ];

    function isBlacklisted(lowerUrl, lowerName) {
        var i;
        for (i = 0; i < NON_ONLINE_BLACKLIST.length; i++) {
            if (lowerUrl.indexOf(NON_ONLINE_BLACKLIST[i]) !== -1 || lowerName.indexOf(NON_ONLINE_BLACKLIST[i]) !== -1) return true;
        }
        return false;
    }

    // =========================================================================
    // 6. МОДУЛЬНАЯ СИСТЕМА АДАПТЕРОВ (AdapterFactory)
    // =========================================================================
    // Единый контракт адаптера:
    //   getSourceInfo(), isAvailable(cb), searchMovie(meta, opts, cb),
    //   searchSeries(meta, opts, cb), getStreams(item, meta, cb), play(result, meta)
    var AdapterFactory = {
        extractOrigin: function (url) {
            if (!url || typeof url !== 'string') return '';
            var m = url.match(/^(https?:\/\/[^\/\?#]+)/i);
            return m ? m[1] : '';
        },

        /**
         * Создаёт адаптер для Lampac / BWA и Lampac-совместимых серверов (/lite/events).
         */
        createLampacAdapter: function (pluginMeta) {
            var origin = AdapterFactory.extractOrigin(pluginMeta.url);

            function runSearch(mediaMeta, opts, callback) {
                if (!origin) {
                    callback({ status: 'unsupported', error: 'Отсутствует HTTP-адрес сервера', results: [] });
                    return;
                }
                probeEndpoint(origin + '/lite/events?life=true', opts, function (err, resp) {
                    if (err || !resp) {
                        var isStrictLampac = pluginMeta.kind === 'lampac_protocol';
                        callback({
                            status: isStrictLampac ? 'error' : 'unsupported',
                            error: isStrictLampac ? ('Сервер не ответил (/lite/events): ' + (err || 'пустой ответ')) : 'Плагин не поддерживает программный API /lite/events',
                            results: []
                        });
                        return;
                    }
                    var balancers = parseLampacBalancers(resp);
                    if (!balancers.length) {
                        callback({ status: 'empty', error: '', results: [] });
                        return;
                    }

                    var allResults = [];
                    var doneCount = 0;
                    var hadErr = false;
                    var i;
                    for (i = 0; i < balancers.length; i++) {
                        (function (bal) {
                            queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, 0, 0, function (bErr, list) {
                                if (bErr) hadErr = true;
                                if (list && list.length) allResults = allResults.concat(list);
                                doneCount++;
                                if (doneCount >= balancers.length) {
                                    if (allResults.length) callback({ status: 'found', error: '', results: allResults });
                                    else if (hadErr) callback({ status: 'error', error: 'Ошибки при опросе балансиров', results: [] });
                                    else callback({ status: 'empty', error: '', results: [] });
                                }
                            });
                        })(balancers[i]);
                    }
                });
            }

            return {
                getSourceInfo: function () {
                    return {
                        id: pluginMeta.id,
                        name: pluginMeta.name,
                        url: pluginMeta.url || '',
                        kind: pluginMeta.kind,
                        supported: true,
                        integrationLevel: pluginMeta.kind === 'lampac_protocol' ? 'full' : 'probe',
                        reason: pluginMeta.kind === 'lampac_protocol'
                            ? 'Поддерживается программный поиск (/lite/events) и прямой запуск'
                            : 'Проверка /lite/events; при отсутствии API — делегирование штатной кнопки'
                    };
                },
                isAvailable: function (cb) {
                    if (!origin) { cb(false, 'Нет URL сервера', 0); return; }
                    var t0 = Date.now();
                    probeEndpoint(origin + '/lite/events?life=true', { noRetry: true }, function (err, resp) {
                        var lat = Date.now() - t0;
                        if (err || !resp) {
                            cb(false, err || 'Сервер недоступен', lat);
                            return;
                        }
                        var bals = parseLampacBalancers(resp);
                        cb(bals.length > 0, bals.length > 0 ? ('Доступно балансиров: ' + bals.length) : 'Сервер ответил без балансиров', lat);
                    });
                },
                searchMovie: function (mediaMeta, opts, cb) { runSearch(mediaMeta, opts, cb); },
                searchSeries: function (mediaMeta, opts, cb) { runSearch(mediaMeta, opts, cb); },
                getStreams: function (item, mediaMeta, cb) {
                    cb(null, item && item.streamUrl ? [{ url: item.streamUrl, quality: item.qualityMap || null }] : []);
                },
                play: function (result, mediaMeta) {
                    return launchPlaybackSafe(result, mediaMeta);
                }
            };
        },

        /**
         * Создаёт честный адаптер для закрытых плагинов (Online Mod, HDRezka, KinoPub, и др.),
         * не имеющих публичного программного API поиска: не выдумывает результаты,
         * а безопасно делегирует запуск живой кнопке плагина в карточке.
         */
        createNativeDelegationAdapter: function (pluginMeta) {
            return {
                getSourceInfo: function () {
                    return {
                        id: pluginMeta.id,
                        name: pluginMeta.name,
                        url: pluginMeta.url || '',
                        kind: pluginMeta.kind,
                        supported: false,
                        integrationLevel: 'partial',
                        reason: 'Закрытый плагин без публичного JS-API поиска; доступен запуск через оригинальную кнопку в карточке'
                    };
                },
                isAvailable: function (cb) {
                    if (!pluginMeta.url || pluginMeta.url.indexOf('http') !== 0) {
                        cb(true, 'Локальный плагин (кнопка карточки)', 0);
                        return;
                    }
                    var t0 = Date.now();
                    probeEndpoint(pluginMeta.url, { noRetry: true }, function (err) {
                        cb(!err, !err ? 'Скрипт плагина доступен (без API поиска)' : ('Недоступен: ' + err), Date.now() - t0);
                    });
                },
                searchMovie: function (mediaMeta, opts, cb) {
                    cb({ status: 'unsupported', error: 'Плагин не предоставляет API программного поиска', results: [] });
                },
                searchSeries: function (mediaMeta, opts, cb) {
                    cb({ status: 'unsupported', error: 'Плагин не предоставляет API программного поиска', results: [] });
                },
                getStreams: function (item, mediaMeta, cb) { cb('Программное получение потоков не поддерживается', []); },
                play: function (result, mediaMeta) {
                    return CardIntegration.launchPluginLiveButton(pluginMeta.id);
                }
            };
        },

        /**
         * Оборачивает внешний пользовательский адаптер (window.ANDRPROD_API.registerAdapter)
         * в стандартный контракт адаптера ANDRPROD DD.
         */
        wrapCustomAdapter: function (raw) {
            return {
                getSourceInfo: function () {
                    if (typeof raw.getSourceInfo === 'function') return raw.getSourceInfo();
                    return {
                        id: raw.id,
                        name: raw.name || raw.id,
                        url: raw.url || '',
                        kind: 'custom_adapter',
                        supported: true,
                        integrationLevel: 'full',
                        reason: raw.description || 'Пользовательский API-адаптер'
                    };
                },
                isAvailable: function (cb) {
                    if (typeof raw.isAvailable === 'function') { raw.isAvailable(cb); return; }
                    if (typeof raw.check === 'function') { raw.check(cb); return; }
                    cb(true, 'Пользовательский адаптер активен', 0);
                },
                searchMovie: function (mediaMeta, opts, cb) {
                    var fn = typeof raw.searchMovie === 'function' ? raw.searchMovie : raw.search;
                    if (typeof fn !== 'function') { cb({ status: 'unsupported', error: 'Метод поиска не реализован', results: [] }); return; }
                    invokeCustomSearch(raw, fn, mediaMeta, opts, cb);
                },
                searchSeries: function (mediaMeta, opts, cb) {
                    var fn = typeof raw.searchSeries === 'function' ? raw.searchSeries : raw.search;
                    if (typeof fn !== 'function') { cb({ status: 'unsupported', error: 'Метод поиска не реализован', results: [] }); return; }
                    invokeCustomSearch(raw, fn, mediaMeta, opts, cb);
                },
                getStreams: function (item, mediaMeta, cb) {
                    if (typeof raw.getStreams === 'function') { raw.getStreams(item, mediaMeta, cb); return; }
                    cb(null, item && item.streamUrl ? [{ url: item.streamUrl, quality: item.qualityMap || null }] : []);
                },
                play: function (result, mediaMeta) {
                    if (typeof raw.play === 'function') return raw.play(result, mediaMeta);
                    if (typeof raw.open === 'function') { raw.open(mediaMeta ? mediaMeta.rawCard : {}, function () {}, result); return true; }
                    return launchPlaybackSafe(result, mediaMeta);
                }
            };
        }
    };

    function invokeCustomSearch(raw, fn, mediaMeta, opts, cb) {
        var t0 = Date.now();
        var finished = false;
        var timer = setTimeout(function () {
            if (finished) return;
            finished = true;
            cb({ status: 'error', error: 'Таймаут адаптера', results: [] });
        }, StorageManager.getTimeoutMs());
        UnifiedSearchEngine._trackTimer(timer);

        try {
            fn(mediaMeta, mediaMeta.queryVariants, function (err, list) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (err) {
                    Diagnostics.logError('Adapter:' + (raw.name || raw.id), err);
                    cb({ status: 'error', error: String(err), results: [] });
                    return;
                }
                var normalized = normalizeResultArray(raw.id, raw.name || raw.id, list, Date.now() - t0, mediaMeta);
                cb({ status: normalized.length ? 'found' : 'empty', error: '', results: normalized });
            });
        } catch (e) {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                Diagnostics.logError('Adapter:' + (raw.name || raw.id), e);
                cb({ status: 'error', error: e.message || String(e), results: [] });
            }
        }
    }

    function probeEndpoint(url, opts, callback) {
        opts = opts || {};
        var net = null;
        try {
            net = new Lampa.Reguest();
            net.timeout(StorageManager.getTimeoutMs());
            UnifiedSearchEngine._trackNet(net);
        } catch (e) {
            Diagnostics.logError('Network', e);
            callback('Lampa.Reguest недоступен', null);
            return;
        }

        var done = false;
        var guard = setTimeout(function () {
            if (done) return;
            done = true;
            try { net.clear(); } catch (eC) {}
            callback('Таймаут (' + Math.round(StorageManager.getTimeoutMs() / 1000) + ' с)', null);
        }, StorageManager.getTimeoutMs() + 250);
        UnifiedSearchEngine._trackTimer(guard);

        net.silent(
            url,
            function (resp) {
                if (done) return;
                done = true;
                clearTimeout(guard);
                callback(null, resp);
            },
            function () {
                if (done) return;
                done = true;
                clearTimeout(guard);
                callback('Ошибка сети', null);
            },
            false,
            { dataType: 'text' }
        );
    }

    function parseLampacBalancers(payload) {
        var out = [], raw = payload;
        if (typeof payload === 'string') {
            try { raw = JSON.parse(payload); } catch (e) { return out; }
        }
        if (!raw || typeof raw !== 'object') return out;

        function addList(list) {
            if (Object.prototype.toString.call(list) !== '[object Array]') return;
            var i, it, url;
            for (i = 0; i < list.length; i++) {
                it = list[i];
                if (!it || typeof it !== 'object' || it.show === false || it.disabled === true) continue;
                url = it.url || it.href || it.host || '';
                if (!url) continue;
                out.push({
                    id: makeSafeId(it.balanser || it.id || it.name || ('bal_' + i)),
                    name: it.name || it.title || it.balanser || ('Источник ' + (i + 1)),
                    url: url
                });
            }
        }

        addList(raw);
        addList(raw.channels);
        addList(raw.results);
        addList(raw.online);
        addList(raw.balancers);
        addList(raw.data);
        if (raw.life && typeof raw.life === 'object') {
            addList(raw.life.online);
            addList(raw.life.balancers);
            addList(raw.life.channels);
        }

        var unique = [], seen = {}, j, key;
        for (j = 0; j < out.length; j++) {
            key = String(out[j].url).replace(/\/+$/, '').toLowerCase();
            if (!seen[key]) { seen[key] = true; unique.push(out[j]); }
        }
        return unique;
    }

    function queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, variantIdx, retryCount, callback) {
        var variants = mediaMeta.queryVariants || [];
        if (variantIdx >= Math.min(variants.length, 3)) {
            callback(null, []);
            return;
        }
        var q = variants[variantIdx];
        var sep = bal.url.indexOf('?') === -1 ? '?' : '&';
        var reqUrl = bal.url + sep +
            'rjson=true' +
            '&title=' + encodeURIComponent(q) +
            (mediaMeta.originalTitle ? '&original_title=' + encodeURIComponent(mediaMeta.originalTitle) : '') +
            (mediaMeta.year ? '&year=' + encodeURIComponent(mediaMeta.year) : '') +
            (mediaMeta.imdbId ? '&imdb_id=' + encodeURIComponent(mediaMeta.imdbId) : '') +
            (mediaMeta.kinopoiskId ? '&kinopoisk_id=' + encodeURIComponent(mediaMeta.kinopoiskId) : '') +
            (mediaMeta.id ? '&id=' + encodeURIComponent(mediaMeta.id) : '') +
            (mediaMeta.uid ? '&uid=' + encodeURIComponent(mediaMeta.uid) : '') +
            '&serial=' + (mediaMeta.isSeries ? '1' : '0') +
            (mediaMeta.season ? '&season=' + encodeURIComponent(mediaMeta.season) : '') +
            (mediaMeta.episode ? '&episode=' + encodeURIComponent(mediaMeta.episode) : '');

        var t0 = Date.now();
        probeEndpoint(reqUrl, opts, function (err, resp) {
            if (err) {
                // Ограниченный повторный запрос (максимум 1 раз при включённой настройке)
                if (retryCount < 1 && StorageManager.isRetryOnError() && !opts.noRetry) {
                    queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, variantIdx, retryCount + 1, callback);
                    return;
                }
                callback(err, []);
                return;
            }
            var parsed = parseLampacStreams(pluginMeta, bal, mediaMeta, resp, Date.now() - t0);
            if (parsed.length) callback(null, parsed);
            else queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, variantIdx + 1, 0, callback);
        });
    }

    /**
     * Парсит ВСЕ найденные варианты без искусственного ограничения (20, 30, 50+ вариантов).
     */
    function parseLampacStreams(pluginMeta, bal, mediaMeta, rawResp, latency) {
        var out = [];
        var data = rawResp;
        if (typeof rawResp === 'string') {
            try { data = JSON.parse(rawResp); }
            catch (e) {
                var re = /<[^>]*class=["'][^"']*videos__item[^"']*["'][^>]*>/gi;
                var match, attr, txt, obj, arr, k, itemHtml, u, qm, qt;
                while ((match = re.exec(rawResp))) {
                    attr = match[0].match(/data-json=["']([^"']+)["']/i);
                    if (!attr) continue;
                    txt = attr[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
                    try {
                        obj = JSON.parse(txt);
                        arr = Object.prototype.toString.call(obj) === '[object Array]' ? obj :
                            (obj.data || obj.results || [obj]);
                        if (Object.prototype.toString.call(arr) !== '[object Array]') continue;
                        for (k = 0; k < arr.length; k++) {
                            itemHtml = arr[k];
                            if (!itemHtml || typeof itemHtml !== 'object') continue;
                            u = itemHtml.url || itemHtml.file || itemHtml.stream || '';
                            qm = itemHtml.quality && typeof itemHtml.quality === 'object' ? itemHtml.quality : null;
                            qt = itemHtml.maxquality || itemHtml.quality_label ||
                                (typeof itemHtml.quality === 'string' ? itemHtml.quality : '');
                            if (qm) {
                                var qk;
                                for (qk in qm) if (qm.hasOwnProperty(qk) && qm[qk]) {
                                    out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, itemHtml, qm[qk], qk, qm, latency, mediaMeta));
                                }
                            } else if (u) {
                                out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, itemHtml, u, qt, null, latency, mediaMeta));
                            }
                        }
                    } catch (ignoreJson) {}
                }
                return out;
            }
        }
        var list = Object.prototype.toString.call(data) === '[object Array]'
            ? data
            : (data && Object.prototype.toString.call(data.data) === '[object Array]' ? data.data : null);
        if (!list || !list.length) return out;

        var i, item, streamUrl, qMap, qText;
        for (i = 0; i < list.length; i++) {
            item = list[i];
            if (!item || typeof item !== 'object') continue;
            streamUrl = item.url || item.file || item.stream || '';
            qMap = (item.quality && typeof item.quality === 'object') ? item.quality : null;
            qText = item.maxquality || item.quality_label || (typeof item.quality === 'string' ? item.quality : '');

            // Если сервер вернул несколько качеств для одного видео — создаём отдельный вариант на каждое качество!
            if (qMap) {
                var qKey;
                for (qKey in qMap) {
                    if (!qMap.hasOwnProperty(qKey) || !qMap[qKey]) continue;
                    out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, item, qMap[qKey], qKey, qMap, latency, mediaMeta));
                }
            } else if (streamUrl) {
                out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, item, streamUrl, qText, null, latency, mediaMeta));
            }
        }
        return out;
    }

    function normalizeResultArray(pluginId, pluginName, rawList, latency, mediaMeta) {
        var out = [];
        if (Object.prototype.toString.call(rawList) !== '[object Array]') return out;
        var i, r;
        for (i = 0; i < rawList.length; i++) {
            r = rawList[i];
            if (!r || typeof r !== 'object') continue;
            out.push(buildNormalizedVariant(
                pluginId,
                pluginName,
                r.sourceName || r.name || pluginName,
                r,
                r.streamUrl || r.url || '',
                r.quality || r.maxquality || '',
                r.qualityMap || null,
                typeof r.latency === 'number' ? r.latency : latency,
                mediaMeta
            ));
        }
        return out;
    }

    function buildNormalizedVariant(pluginId, pluginName, sourceName, raw, streamUrl, qualityStr, qualityMap, latency, mediaMeta) {
        var qNum = extractResolutionNumber(qualityStr);
        var voice = safeTrim(raw.translate || raw.voice || '');
        var langCode = detectLanguageCode(raw.lang || raw.language || '', voice);
        var format = safeTrim(raw.format || raw.rip || extractVideoFormat(raw.title || raw.info || ''));
        var subtitles = raw.subtitles || raw.cc || '';
        var hdr = !!(raw.hdr || (qualityStr && String(qualityStr).toLowerCase().indexOf('hdr') !== -1));
        var dv = !!(raw.dv || raw.dolby_vision || (qualityStr && (String(qualityStr).toLowerCase().indexOf('dolby vision') !== -1 || /\bdv\b/i.test(String(qualityStr)))));

        return {
            pluginId: pluginId,
            pluginName: pluginName,
            sourceName: sourceName,
            matchedTitle: raw.title || raw.matchedTitle || (mediaMeta ? mediaMeta.title : ''),
            year: raw.year || (mediaMeta ? mediaMeta.year : ''),
            qualityNum: qNum,                       // 2160 | 1080 | 720 | 480 | 0 (неизвестно)
            qualityLabel: formatQualityLabel(qNum, hdr, dv),
            hdr: hdr,
            dv: dv,
            voice: voice,
            langCode: langCode,                     // 'uk' | 'ru' | 'en' | 'other' | 'unknown'
            langLabel: formatLanguageLabel(langCode),
            format: format,                         // 'WEBRip' | 'WEB-DL' | 'BDRip' | ''
            subtitles: subtitles,
            hasSubtitles: !!(subtitles && (typeof subtitles === 'string' ? subtitles.length : (subtitles.length > 0))),
            season: raw.season || raw.s || '',
            episode: raw.episode || raw.e || '',
            streamUrl: streamUrl || '',
            qualityMap: qualityMap,
            canPlay: !!streamUrl,
            latency: latency || 0
        };
    }

    function extractResolutionNumber(str) {
        if (!str) return 0;
        var s = String(str).toLowerCase();
        if (s.indexOf('2160') !== -1 || s.indexOf('4k') !== -1 || s.indexOf('uhd') !== -1) return 2160;
        if (s.indexOf('1080') !== -1 || s.indexOf('fhd') !== -1 || s.indexOf('full hd') !== -1) return 1080;
        if (s.indexOf('720') !== -1 || /\bhd\b/.test(s)) return 720;
        if (s.indexOf('480') !== -1 || s.indexOf('360') !== -1 || /\bsd\b/.test(s)) return 480;
        return 0;
    }

    function formatQualityLabel(qNum, hdr, dv) {
        var base = qNum === 2160 ? '4K / 2160p' : (qNum === 1080 ? '1080p' : (qNum === 720 ? '720p' : (qNum === 480 ? '480p' : 'Неизвестно')));
        if (dv) base += ' DV';
        if (hdr) base += ' HDR';
        return base;
    }

    function detectLanguageCode(explicitLang, voice) {
        var raw = (String(explicitLang || '') + ' ' + String(voice || '')).toLowerCase();
        if (!safeTrim(raw)) return 'unknown';
        if (/\b(uk|ua|укр|україн|украин)\b/.test(raw) || raw.indexOf('укр') !== -1) return 'uk';
        if (/\b(ru|rus|рус|дубляж|многоголос|одноголос|lostfilm|hdrezka|rhs|red head)\b/.test(raw) || raw.indexOf('рус') !== -1) return 'ru';
        if (/\b(en|eng|english|англ|original|оригинал)\b/.test(raw) || raw.indexOf('англ') !== -1) return 'en';
        return 'other';
    }

    function formatLanguageLabel(code) {
        if (code === 'uk') return 'Украинский';
        if (code === 'ru') return 'Русский';
        if (code === 'en') return 'Английский';
        if (code === 'other') return 'Другой';
        return 'Неизвестно';
    }

    function extractVideoFormat(text) {
        if (!text) return '';
        var m = String(text).match(/\b(WEB-?DL|WEBRip|BDRip|BluRay|HDRip|DVDRip|TS|CAMRip|HLS)\b/i);
        return m ? m[1].toUpperCase() : '';
    }

    function launchPlaybackSafe(result, mediaMeta) {
        if (!result) return false;
        try {
            if (result.streamUrl && window.Lampa && Lampa.Player && typeof Lampa.Player.play === 'function') {
                var playTitle = (mediaMeta && mediaMeta.title ? mediaMeta.title : result.matchedTitle || result.sourceName);
                if (result.season && result.episode) playTitle += ' • S' + result.season + 'E' + result.episode;
                Lampa.Player.play({
                    url: result.streamUrl,
                    title: playTitle,
                    quality: result.qualityMap || undefined,
                    subtitles: result.subtitles || undefined
                });
                return true;
            }
        } catch (err) {
            Diagnostics.logError('Player.play', err);
        }
        return CardIntegration.launchPluginLiveButton(result.pluginId);
    }

    // =========================================================================
    // 7. РЕЕСТР АДАПТЕРОВ ИСТОЧНИКОВ (SourceRegistry)
    // =========================================================================
    var SourceRegistry = {
        adapters: {},       // id -> Adapter
        customAdapters: {}, // id -> wrapped Adapter

        resetAndScan: function () {
            var self = this;
            var found = {};
            var unsupported = [];
            var seenUn = {};

            var cid;
            for (cid in self.customAdapters) {
                if (self.customAdapters.hasOwnProperty(cid)) found[cid] = self.customAdapters[cid];
            }

            var rawPlugins = [];
            try {
                var stored = Lampa.Storage.get('plugins', []);
                if (Object.prototype.toString.call(stored) === '[object Array]') rawPlugins = rawPlugins.concat(stored);
            } catch (e1) { Diagnostics.logError('SourceRegistry.storage', e1); }
            try {
                if (Lampa.Manifest && Object.prototype.toString.call(Lampa.Manifest.plugins) === '[object Array]') {
                    rawPlugins = rawPlugins.concat(Lampa.Manifest.plugins);
                }
            } catch (e2) { Diagnostics.logError('SourceRegistry.manifest', e2); }

            var i, j, k, p, pUrl, pName, lowerUrl, lowerName, matched;
            for (i = 0; i < rawPlugins.length; i++) {
                p = rawPlugins[i];
                if (!p) continue;
                if (typeof p === 'string') { pUrl = p; pName = ''; }
                else {
                    if (p.status === 0) continue;
                    pUrl = p.url || p.src || '';
                    pName = p.name || p.title || '';
                }
                if (!pUrl && !pName) continue;
                lowerUrl = String(pUrl).toLowerCase();
                lowerName = String(pName).toLowerCase();
                if (lowerUrl.indexOf('andrprod') !== -1 || lowerName.indexOf('andrprod') !== -1) continue;

                if (isBlacklisted(lowerUrl, lowerName)) {
                    if (!seenUn[pUrl || pName]) {
                        seenUn[pUrl || pName] = true;
                        unsupported.push({ name: pName || extractPluginLabel(pUrl), url: pUrl, reason: 'Не является онлайн-кинотеатром' });
                    }
                    continue;
                }

                matched = null;
                for (j = 0; j < ONLINE_PLUGIN_WHITELIST.length; j++) {
                    var prof = ONLINE_PLUGIN_WHITELIST[j];
                    for (k = 0; k < prof.patterns.length; k++) {
                        if (lowerUrl.indexOf(prof.patterns[k]) !== -1 || lowerName.indexOf(prof.patterns[k]) !== -1) {
                            matched = prof;
                            break;
                        }
                    }
                    if (matched) break;
                }

                if (matched) {
                    if (!found[matched.id]) {
                        var meta = { id: matched.id, name: pName || matched.name, url: pUrl, kind: matched.kind, buttonHints: matched.buttonHints };
                        found[matched.id] = (matched.kind === 'lampac_protocol' || matched.kind === 'lampac_or_native')
                            ? AdapterFactory.createLampacAdapter(meta)
                            : AdapterFactory.createNativeDelegationAdapter(meta);
                    }
                } else {
                    if (!seenUn[pUrl || pName]) {
                        seenUn[pUrl || pName] = true;
                        unsupported.push({ name: pName || extractPluginLabel(pUrl), url: pUrl, reason: 'Нет подтверждённого адаптера онлайн-источника' });
                    }
                }
            }

            Diagnostics.unsupportedPlugins = unsupported;
            self.adapters = found;
            return self.getAdapters();
        },

        registerAdapter: function (rawAdapter) {
            if (!rawAdapter || !rawAdapter.id) return false;
            var wrapped = AdapterFactory.wrapCustomAdapter(rawAdapter);
            this.customAdapters[rawAdapter.id] = wrapped;
            this.adapters[rawAdapter.id] = wrapped;
            return true;
        },

        getAdapters: function () {
            var list = [];
            var id;
            for (id in this.adapters) if (this.adapters.hasOwnProperty(id)) list.push(this.adapters[id]);
            var prio = StorageManager.getPriorities();
            list.sort(function (a, b) {
                var ia = a.getSourceInfo().id;
                var ib = b.getSourceInfo().id;
                var pa = prio.indexOf(ia);
                var pb = prio.indexOf(ib);
                if (pa !== -1 && pb !== -1) return pa - pb;
                if (pa !== -1) return -1;
                if (pb !== -1) return 1;
                return String(a.getSourceInfo().name).localeCompare(String(b.getSourceInfo().name));
            });
            return list;
        },

        getAdapterById: function (id) { return this.adapters[id] || null; }
    };

    // =========================================================================
    // 8. ФИЛЬТРАЦИЯ (ЯЗЫКИ + MIN/MAX КАЧЕСТВО + ОЗВУЧКА + СОРТИРОВКА)
    // =========================================================================
    var FilterEngine = {
        qualityToNum: function (qStr) {
            if (qStr === '4k' || qStr === '2160p') return 2160;
            if (qStr === '1080p') return 1080;
            if (qStr === '720p') return 720;
            if (qStr === '480p') return 480;
            return 0;
        },

        apply: function (results) {
            var langs = StorageManager.getAllowedLanguages();
            var minQ = FilterEngine.qualityToNum(StorageManager.getMinQuality());
            var maxQ = FilterEngine.qualityToNum(StorageManager.getMaxQuality());
            var hideUnmatched = StorageManager.isHideUnmatched();
            var prefVoice = StorageManager.getPrefVoice();

            var out = [];
            var i, r;