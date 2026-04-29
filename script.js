document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    // IMPORTANT: If you have an OpenWeatherMap API key you can paste it here.
    // If left empty or 'YOUR_API_KEY_HERE', the app will use the free Open-Meteo API as a fallback.
    const API_KEY = ''; // <-- add your OWM key here if available

    // Default location: Shimla, Himachal Pradesh
    const DEFAULT_LOCATION = {
        name: "Shimla",
        coords: [31.1048, 77.1734]
    };

    // A small local list still used for recent-search matching (optional)
    const INDIAN_CITIES = [
        { name: "Delhi", coords: [28.6139, 77.2090] },
        { name: "Mumbai", coords: [19.0760, 72.8777] },
        { name: "Kolkata", coords: [22.5726, 88.3639] },
        { name: "Chennai", coords: [13.0827, 80.2707] },
        { name: "Bengaluru", coords: [12.9716, 77.5946] },
        { name: "Hyderabad", coords: [17.3850, 78.4867] },
        { name: "Jaipur", coords: [26.9124, 75.7873] },
        { name: "Lucknow", coords: [26.8467, 80.9462] },
        { name: "Ahmedabad", coords: [23.0225, 72.5714] },
        { name: "Pune", coords: [18.5204, 73.8567] },
        { name: "Shimla", coords: [31.1048, 77.1734] },
    ];

    // --- DOM ELEMENTS ---
    const locationName = document.getElementById('location-name');
    const temperature = document.getElementById('temperature');
    const condition = document.getElementById('condition');
    const humidity = document.getElementById('humidity');
    const wind = document.getElementById('wind');
    const citySearch = document.getElementById('city-search');
    const autocompleteList = document.getElementById('autocomplete-list');
    const recentSearches = document.getElementById('recent-searches');
    const weatherSpinner = document.getElementById('weather-spinner');

    // --- THEME (day / night) --- dynamic, persisted, slider-controlled
    const themeToggle = document.getElementById('theme-toggle');
    const THEME_KEY = 'himalayan-theme';
    function applyTheme(name) {
        document.body.classList.remove('theme-day', 'theme-night');
        document.body.classList.add(`theme-${name}`);
        try { localStorage.setItem(THEME_KEY, name); } catch (e) { /* ignore */ }
    }
    function detectDefaultTheme() {
        try {
            const saved = localStorage.getItem(THEME_KEY);
            if (saved === 'day' || saved === 'night') return saved;
        } catch (e) { /* ignore */ }
        const hour = new Date().getHours();
        return (hour >= 7 && hour < 19) ? 'day' : 'night';
    }
    // initialize theme
    const initTheme = detectDefaultTheme();
    applyTheme(initTheme);
    if (themeToggle) {
        themeToggle.checked = (initTheme === 'night');
        themeToggle.addEventListener('change', () => {
            applyTheme(themeToggle.checked ? 'night' : 'day');
        });
    }

    const useOWM = API_KEY && API_KEY !== 'YOUR_API_KEY_HERE';

    // No API-notice behavior. App will silently fallback to Open-Meteo when API key is not provided.

    // --- MAP INITIALIZATION ---
    // helper: responsive map zoom
    function getMapZoom() {
        const w = window.innerWidth || document.documentElement.clientWidth || 980;
        if (w <= 520) return 8;    // phone
        if (w <= 900) return 9;    // tablet
        return 10;                 // desktop
    }

    // initialize map with responsive zoom
    let map = L.map('map').setView(DEFAULT_LOCATION.coords, getMapZoom());

    // Base OSM layer
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Weather overlay layers (OpenWeatherMap tiles). Created when API key present.
    const overlayLayers = {}; // layerName -> tileLayer
    let currentOverlay = null;

    // Map controls DOM
    const layerSelect = document.getElementById('weather-layer-select');
    const mapRefreshBtn = document.getElementById('map-refresh');
    const mapTimestampEl = document.getElementById('map-timestamp');

    function formatMapTimestamp() {
        return `Map: ${new Date().toLocaleString()}`;
    }

    function setMapTimestamp() {
        if (mapTimestampEl) mapTimestampEl.textContent = formatMapTimestamp();
    }

    // Build overlay tile layer if OWM key available
    function getOwmTileLayer(name) {
        if (!useOWM) return null;
        if (overlayLayers[name]) return overlayLayers[name];
        const url = `https://tile.openweathermap.org/map/${name}/{z}/{x}/{y}.png?appid=${API_KEY}`;
        const layer = L.tileLayer(url, { opacity: 0.0, attribution: '&copy; OpenWeatherMap' });
        overlayLayers[name] = layer;
        return layer;
    }

    // Handle layer select change
    if (layerSelect) {
        layerSelect.addEventListener('change', () => {
            const val = layerSelect.value;
            if (currentOverlay) {
                // fade old out then remove
                try { currentOverlay.setOpacity(0.0); } catch (e) {}
                setTimeout(() => { if (currentOverlay && map.hasLayer(currentOverlay)) map.removeLayer(currentOverlay); }, 240);
            }
            if (val && useOWM) {
                const tile = getOwmTileLayer(val);
                if (tile) {
                    tile.addTo(map);
                    // small delay then fade in
                    setTimeout(() => { try { tile.setOpacity(0.7); } catch (e) {} }, 80);
                    currentOverlay = tile;
                }
            } else {
                currentOverlay = null;
            }
            setMapTimestamp();
        });
        // disable overlays when no API key
        if (!useOWM) {
            layerSelect.disabled = true;
            if (mapTimestampEl) mapTimestampEl.textContent = 'Weather overlays require OpenWeather API key';
        } else {
            setMapTimestamp();
        }
    }

    if (mapRefreshBtn) {
        mapRefreshBtn.addEventListener('click', () => {
            // re-add current overlay (forces tiles reload)
            if (currentOverlay) {
                map.removeLayer(currentOverlay);
                setTimeout(() => { currentOverlay.addTo(map); }, 80);
            }
            setMapTimestamp();
        });
    }

    // Add marker for the default location
    const pulseDivIcon = L.divIcon({
        className: 'pulse-marker',
        html: '<div class="pin" aria-hidden="true"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
    let marker = L.marker(DEFAULT_LOCATION.coords, { icon: pulseDivIcon }).addTo(map)
        .bindPopup(`<b>${DEFAULT_LOCATION.name}</b>`);

    // Map click to select location via reverse geocoding
    map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        try {
            // Reverse geocode using Nominatim
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
            const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
            if (!res.ok) throw new Error('Reverse geocoding failed');
            const data = await res.json();
            const name = data.display_name || data.name || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
            selectPlace(name, [lat, lng]);
        } catch (err) {
            console.warn('Map click error', err);
            // Fallback: use coordinates as location name
            selectPlace(`${lat.toFixed(2)}, ${lng.toFixed(2)}`, [lat, lng]);
        }
    });

    // --- HELPERS ---
    function showSpinner(show) {
        weatherSpinner.style.display = show ? 'block' : 'none';
    }

    // updateMap: use responsive zoom when centering so marker is framed nicely on phones
    function updateMap(coords, name) {
        const zoom = getMapZoom();
        map.setView(coords, zoom);
        marker.setLatLng(coords).setPopupContent(`<b>${name}</b>`).openPopup();
        // slight bounce animation to draw attention
        try {
            const el = marker.getElement && marker.getElement();
            if (el) {
                el.style.transformOrigin = 'center';
                el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1)' });
            }
        } catch (e) { /* ignore if DOM not available yet */ }
    }

    function addRecentSearch(name, coords) {
        let exists = Array.from(recentSearches.options).some(opt => opt.value === name);
        if (!exists) {
            let opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            recentSearches.appendChild(opt);
        }
    }

    // --- Debounce helper for queries ---
    function debounce(fn, delay = 350) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

    // --- PLACE FINDER using Nominatim (free, no key required) ---
    const nominatimSearch = async (query) => {
        const q = encodeURIComponent(query);
        // limit to India (countrycodes=in) for relevant results
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${q}&limit=6&addressdetails=1&countrycodes=in`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!res.ok) throw new Error('Place search failed');
        return res.json();
    };

    // PLACE FINDER input — attach only if inputs exist
    if (citySearch && autocompleteList) {
        citySearch.addEventListener('input', debounce(async () => {
            const val = citySearch.value.trim();
            autocompleteList.innerHTML = '';
            if (val.length < 2) return;

            // Try local city startsWith for instant suggestions
            const localMatches = INDIAN_CITIES.filter(c => c.name.toLowerCase().startsWith(val.toLowerCase()));
            localMatches.slice(0, 4).forEach(city => {
                const li = document.createElement('li');
                li.textContent = city.name;
                li.tabIndex = 0;
                li.addEventListener('click', () => selectPlace(city.name, city.coords));
                autocompleteList.appendChild(li);
            });

            // Then query Nominatim for broader place-finder results
            try {
                const results = await nominatimSearch(val);
                results.forEach(r => {
                    const name = r.display_name;
                    const lat = parseFloat(r.lat);
                    const lon = parseFloat(r.lon);
                    const li = document.createElement('li');
                    li.textContent = name;
                    li.tabIndex = 0;
                    li.addEventListener('click', () => selectPlace(name, [lat, lon]));
                    autocompleteList.appendChild(li);
                });
            } catch (err) {
                console.warn('Nominatim error', err);
            }
        }, 300));
    }

    // Prevent blur when clicking autocomplete (if present)
    if (autocompleteList) {
        autocompleteList.addEventListener('mousedown', e => e.preventDefault());
    }

    // Enter key selects first autocomplete item (if present)
    if (citySearch && autocompleteList) {
        citySearch.addEventListener('keydown', e => {
            if (e.key === 'Enter' && autocompleteList.firstChild) {
                autocompleteList.firstChild.click();
            }
        });
    }

    // Recent searches change handler (if select exists)
    if (recentSearches) {
        recentSearches.addEventListener('change', () => {
            let name = recentSearches.value;
            let city = INDIAN_CITIES.find(c => c.name === name);
            if (city) selectPlace(city.name, city.coords);
        });
    }

    function selectPlace(name, coords) {
        citySearch.value = name;
        autocompleteList.innerHTML = '';
        showSpinner(true);
        updateMap(coords, name);
        addRecentSearch(name, coords);
        fetchWeather(coords[0], coords[1], name);
    }

    // --- WEATHER FETCHING (OWM if key, otherwise Open-Meteo fallback) ---
    async function fetchWeather(lat, lon, displayName) {
        showSpinner(true);
        try {
            if (useOWM) {
                // Use One Call API (v3) for accurate current + hourly forecasts (24h)
                const oneCallUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,alerts&appid=${API_KEY}`;
                const resp = await fetch(oneCallUrl);
                if (!resp.ok) {
                    // fallback to /weather if One Call not allowed
                    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
                    const r2 = await fetch(weatherUrl);
                    if (!r2.ok) throw new Error('OWM current weather failed');
                    const data2 = await r2.json();
                    const normalized2 = {
                        name: displayName || data2.name,
                        temp: Math.round(data2.main.temp),
                        cond: data2.weather && data2.weather[0] ? data2.weather[0].main : '',
                        humidity: data2.main.humidity,
                        wind: data2.wind.speed
                    };
                    updateWeatherUI(normalized2);
                    fetchForecastOWM(lat, lon);
                } else {
                    const data = await resp.json();
                    // current
                    const cur = data.current || {};
                    const normalized = {
                        name: displayName || normalizedNameFromCoords(lat, lon),
                        temp: Math.round(cur.temp),
                        cond: (cur.weather && cur.weather[0]) ? cur.weather[0].main : '',
                        humidity: cur.humidity,
                        wind: cur.wind_speed
                    };
                    updateWeatherUI(normalized);
                    // hourly 24h
                    const hourly = (data.hourly || []).slice(0, 24).map(h => ({
                        ts: (h.dt || 0) * 1000,
                        time: new Date((h.dt || 0) * 1000).toISOString(),
                        temp: Math.round(h.temp),
                        cond: (h.weather && h.weather[0]) ? h.weather[0].main : ''
                    }));
                    renderForecastItems(hourly);
                }
            } else {
                // Open-Meteo free API for current weather & short forecast
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,relativehumidity_2m,windspeed_10m&timezone=auto`;
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('Open-Meteo failed');
                const d = await resp.json();
                // Normalize current
                const curr = d.current_weather || {};
                const normalized = {
                    name: displayName || `${lat.toFixed(2)},${lon.toFixed(2)}`,
                    temp: Math.round(curr.temperature),
                    cond: curr.weathercode !== undefined ? `Wcode:${curr.weathercode}` : 'N/A',
                    humidity: (d.hourly && d.hourly.relativehumidity_2m && d.hourly.relativehumidity_2m[0]) || '--',
                    wind: curr.windspeed || 0
                };
                updateWeatherUI(normalized);
                // Update forecast using hourly times (take next 24 hours)
                updateForecastOpenMeteo(d);
            }
        } catch (err) {
            console.error('fetchWeather error', err);
            locationName.textContent = 'Error';
        } finally {
            showSpinner(false);
        }
    }

    // helper: try to build a readable name from coords if reverse geocoding isn't used
    function normalizedNameFromCoords(lat, lon) {
        return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    }

    // --- OWM forecast: get entries within next 24 hours ---
    const fetchForecastOWM = async (lat, lon) => {
        const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('OWM forecast failed');
            const data = await res.json();
            const nowTs = Date.now();
            const dayAheadTs = nowTs + 24 * 60 * 60 * 1000;
            const entries = (data.list || [])
                // map items to normalized shape with timestamp
                .map(item => ({
                    ts: item.dt * 1000,
                    time: item.dt_txt,
                    temp: Math.round(item.main.temp),
                    cond: item.weather && item.weather[0] ? item.weather[0].main : ''
                }))
                // keep only entries within next 24 hours
                .filter(it => it.ts >= nowTs && it.ts <= dayAheadTs);
            // if no entries (very unlikely), fallback to first 8 entries (~24h)
            const finalEntries = entries.length ? entries : (data.list || []).slice(0, 8).map(item => ({
                ts: item.dt * 1000,
                time: item.dt_txt,
                temp: Math.round(item.main.temp),
                cond: item.weather && item.weather[0] ? item.weather[0].main : ''
            }));
            renderForecastItems(finalEntries);
        } catch (err) {
            console.warn('Forecast OWM error', err);
            const list = document.getElementById('forecast-list');
            if (list) list.innerHTML = '<li>Forecast unavailable</li>';
        }
    };

    // --- Open-Meteo forecast renderer: next 24 hours (hourly) ---
    const updateForecastOpenMeteo = (data) => {
        if (!data || !data.hourly || !data.hourly.time) {
            const list = document.getElementById('forecast-list');
            if (list) list.innerHTML = '<li>Forecast unavailable</li>';
            return;
        }
        const times = data.hourly.time;
        const temps = data.hourly.temperature_2m || [];
        const hums = data.hourly.relativehumidity_2m || [];
        const now = new Date();
        // find first index >= now
        let idx = times.findIndex(t => new Date(t) >= now);
        if (idx < 0) idx = 0;
        const end = Math.min(idx + 24, times.length); // up to 24 hours
        const entries = [];
        for (let i = idx; i < end; i++) {
            // use ISO time string (timezone-aware from API) and include ts
            const ts = new Date(times[i]).getTime();
            entries.push({
                ts,
                time: times[i],
                temp: Math.round(temps[i]),
                cond: `${hums[i] || '--'}% RH`
            });
        }
        renderForecastItems(entries);
    };

    // Renders forecast items (common renderer) — supports many entries, formats local time
    function renderForecastItems(entries) {
        const listEl = document.getElementById('forecast-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        if (!entries || entries.length === 0) {
            listEl.innerHTML = '<li>Forecast unavailable</li>';
            return;
        }
        const sorted = entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
        let firstIdx = 0;
        sorted.forEach((item, idx) => {
            const li = document.createElement('li');
            li.className = 'forecast-item';
            let displayTime = '';
            if (item.ts) {
                const d = new Date(item.ts);
                displayTime = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                // choose first index that's the nearest upcoming hour
                if (firstIdx === 0 && d >= new Date()) firstIdx = idx;
            } else if (item.time) {
                const parsed = new Date(item.time);
                if (!isNaN(parsed)) {
                    displayTime = parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    if (firstIdx === 0 && parsed >= new Date()) firstIdx = idx;
                } else {
                    displayTime = item.time.replace(' ', ' @ ');
                }
            }
            const temp = item.temp !== undefined ? `${item.temp}°C` : '--';
            const cond = item.cond || '';
            li.innerHTML = `<div class="forecast-time">${displayTime}</div><div class="forecast-temp">${temp}</div><div class="forecast-cond">${cond}</div>`;
            listEl.appendChild(li);
        });
        // small timeout then smooth scroll to chosen index
        requestAnimationFrame(() => {
            const children = listEl.children;
            if (children && children[firstIdx]) {
                children[firstIdx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            } else if (children[0]) {
                children[0].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        });
    }

    // --- Dynamic temperature color utility and animation ---
    function tempToColor(t) {
        // simple gradient blue (cold) -> teal -> orange -> red (hot)
        if (t === null || t === undefined || isNaN(Number(t))) return getComputedStyle(document.documentElement).getPropertyValue('--temp-color');
        const v = Number(t);
        if (v <= 0) return '#6ec3ff';
        if (v <= 10) return '#7fe0c9';
        if (v <= 20) return '#ffd57a';
        if (v <= 30) return '#ffb36b';
        return '#ff6b6b';
    }

    function animateTempChange() {
        const el = temperature;
        if (!el) return;
        el.classList.remove('temp-anim');
        // force reflow to restart animation
        void el.offsetWidth;
        el.classList.add('temp-anim');
        // remove after animation window
        clearTimeout(el._tempAnimTimeout);
        el._tempAnimTimeout = setTimeout(() => el.classList.remove('temp-anim'), 700);
    }

    // Updates the weather card in the HTML (normalized object)
    function updateWeatherUI(data) {
        locationName.textContent = data.name || 'Unknown';
        temperature.textContent = `${data.temp !== undefined ? data.temp : '--'}°C`;
        condition.textContent = data.cond || '--';
        humidity.textContent = `Humidity: ${data.humidity !== undefined ? data.humidity : '--'}%`;
        wind.textContent = `Wind: ${data.wind !== undefined ? Number(data.wind).toFixed(1) : '--'} km/h`;

        // dynamic color and subtle animation
        const color = tempToColor(data.temp);
        document.documentElement.style.setProperty('--temp-dynamic', color);
        animateTempChange();
    }

    // --- INITIALIZE ---
    // show default location weather on load
    fetchWeather(DEFAULT_LOCATION.coords[0], DEFAULT_LOCATION.coords[1], DEFAULT_LOCATION.name);
    
    // --- MAP FULLSCREEN / EXPAND SUPPORT ---
    (function () {
        const mapCard = document.querySelector('.map-card');
        const fsBtn = document.getElementById('map-fullscreen');
        let isExpanded = false;

        if (!mapCard || !fsBtn) return;

        function enterCssFullscreen() {
            mapCard.classList.add('map-fullscreen');
            isExpanded = true;
            fsBtn.textContent = '✕';
            // ensure leaflet renders correctly after layout change
            setTimeout(() => { if (map && map.invalidateSize) map.invalidateSize(); }, 260);
        }

        function exitCssFullscreen() {
            mapCard.classList.remove('map-fullscreen');
            isExpanded = false;
            fsBtn.textContent = '⤢';
            setTimeout(() => { if (map && map.invalidateSize) map.invalidateSize(); }, 200);
        }

        // Try using Fullscreen API then fall back to CSS fullscreen class
        async function toggleFullscreen() {
            try {
                if (!document.fullscreenElement) {
                    // request fullscreen on the map card if supported
                    if (mapCard.requestFullscreen) {
                        await mapCard.requestFullscreen();
                        enterCssFullscreen();
                    } else if (mapCard.webkitRequestFullscreen) {
                        mapCard.webkitRequestFullscreen();
                        enterCssFullscreen();
                    } else {
                        // fallback CSS-only
                        enterCssFullscreen();
                    }
                } else {
                    // exit fullscreen
                    if (document.exitFullscreen) {
                        await document.exitFullscreen();
                        exitCssFullscreen();
                    } else if (document.webkitExitFullscreen) {
                        document.webkitExitFullscreen();
                        exitCssFullscreen();
                    } else {
                        exitCssFullscreen();
                    }
                }
            } catch (err) {
                // If Fullscreen API fails, toggle via CSS class
                if (isExpanded) exitCssFullscreen(); else enterCssFullscreen();
            }
        }

        fsBtn.addEventListener('click', toggleFullscreen);

        // Ensure we remove CSS class if user uses ESC or browser fullscreen exit
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && isExpanded) exitCssFullscreen();
        });
        document.addEventListener('webkitfullscreenchange', () => {
            if (!document.webkitFullscreenElement && isExpanded) exitCssFullscreen();
        });

        // Allow pressing Escape to close CSS fullscreen if Fullscreen API unavailable
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isExpanded) {
                // try to exit Fullscreen API first
                if (document.fullscreenElement) {
                    if (document.exitFullscreen) document.exitFullscreen().catch(()=>{});
                }
                exitCssFullscreen();
            }
        });

        // When overlay changes or refresh triggers, keep map sized correctly while expanded
        if (mapRefreshBtn) {
            mapRefreshBtn.addEventListener('click', () => {
                if (isExpanded) setTimeout(() => { if (map && map.invalidateSize) map.invalidateSize(); }, 220);
            });
        }
        if (layerSelect) {
            layerSelect.addEventListener('change', () => {
                if (isExpanded) setTimeout(() => { if (map && map.invalidateSize) map.invalidateSize(); }, 220);
            });
        }
    })();

    /* refresh map on orientation change / resize so portrait layout frames correctly */
    function refreshMapLayout() {
        try {
            const center = (marker && marker.getLatLng) ? marker.getLatLng() : DEFAULT_LOCATION.coords;
            if (map && center) {
                map.setView(center, getMapZoom());
                // allow layout changes to settle then invalidate size
                setTimeout(() => { try { if (map && map.invalidateSize) map.invalidateSize(); } catch (e) {} }, 220);
            }
        } catch (e) { /* ignore */ }
    }
    window.addEventListener('orientationchange', refreshMapLayout);
    window.addEventListener('resize', debounce(refreshMapLayout, 200));

    // --- FEEDBACK FORM HANDLER ---
    const feedbackForm = document.getElementById('feedback-form');
    const feedbackStatus = document.getElementById('feedback-status');
    const feedbackList = document.getElementById('feedback-list');
    const feedbackCount = document.getElementById('feedback-count');

    // Function to load and display all feedback
    function loadFeedback() {
        try {
            const stored = localStorage.getItem('weather-feedbacks');
            const feedbacks = stored ? JSON.parse(stored) : [];

            if (feedbackList) {
                feedbackList.innerHTML = '';

                if (feedbacks.length === 0) {
                    feedbackList.innerHTML = '<p class="feedback-empty">No feedback yet. Be the first to share your thoughts!</p>';
                } else {
                    // Display in reverse order (newest first)
                    feedbacks.slice().reverse().forEach((fb, idx) => {
                        const div = document.createElement('div');
                        div.className = 'feedback-item';
                        
                        const date = new Date(fb.timestamp);
                        const formattedDate = date.toLocaleString();
                        
                        div.innerHTML = `
                            <p class="feedback-item-name">${escapeHtml(fb.name)}</p>
                            <p class="feedback-item-email">${escapeHtml(fb.email)}</p>
                            <p class="feedback-item-message">${escapeHtml(fb.message)}</p>
                            <p class="feedback-item-time">${formattedDate}</p>
                        `;
                        feedbackList.appendChild(div);
                    });
                }

                // Update count
                if (feedbackCount) {
                    feedbackCount.textContent = `(${feedbacks.length})`;
                }
            }
        } catch (err) {
            console.warn('Error loading feedback:', err);
        }
    }

    // Helper function to escape HTML
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // Load feedback on page load
    loadFeedback();

    if (feedbackForm) {
        feedbackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('feedback-name').value.trim();
            const email = document.getElementById('feedback-email').value.trim();
            const message = document.getElementById('feedback-message').value.trim();

            feedbackStatus.textContent = 'Submitting...';
            feedbackStatus.className = 'feedback-status';

            try {
                // Store feedback in localStorage (client-side storage)
                let feedbacks = [];
                try {
                    const stored = localStorage.getItem('weather-feedbacks');
                    feedbacks = stored ? JSON.parse(stored) : [];
                } catch (e) { /* ignore */ }

                const feedback = {
                    name,
                    email,
                    message,
                    timestamp: new Date().toISOString()
                };

                feedbacks.push(feedback);
                localStorage.setItem('weather-feedbacks', JSON.stringify(feedbacks));

                // Reload feedback display
                loadFeedback();

                // Show success message
                feedbackStatus.textContent = '✓ Thank you! Your feedback has been saved.';
                feedbackStatus.className = 'feedback-status success';

                // Reset form
                feedbackForm.reset();

                // Clear message after 4 seconds
                setTimeout(() => {
                    feedbackStatus.textContent = '';
                    feedbackStatus.className = 'feedback-status';
                }, 4000);
            } catch (err) {
                console.error('Feedback error:', err);
                feedbackStatus.textContent = '✗ Error saving feedback. Please try again.';
                feedbackStatus.className = 'feedback-status error';
                
                // Clear error message after 4 seconds
                setTimeout(() => {
                    feedbackStatus.textContent = '';
                    feedbackStatus.className = 'feedback-status';
                }, 4000);
            }
        });
    }
});
