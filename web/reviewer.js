// Autoregressive reveal for the "Cloze + Image Occlusion" note type.
//
// Order on each spacebar press:
//   1. Text1 cloze spans (cN, for current card's cloze number N)
//   2. Image-occlusion shapes (hidden shapes for cN)
//   3. Text2 cloze spans (cN)
// After the last item, signals Python to show the answer.

(function () {
    var _text1Texts = [];
    var _text2Texts = [];
    var _enabled = false;

    var _phase = 0; // 0=Text1, 1=IO, 2=Text2, 3=done
    var _phaseIdx = 0;

    // IO reveal state
    var _ioHiddenTotal = -1;

    // ── IO shape filter ──────────────────────────────────────────────────

    function _shapeKey(s) {
        return s.ordinal + "," + Math.round(s.top * 1e4) + "," + Math.round(s.left * 1e4);
    }

    function _shapeOrder(a, b) {
        if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
        if (a.top !== b.top) return a.top - b.top;
        return a.left - b.left;
    }

    function _rerenderIO() {
        if (
            typeof anki !== "undefined"
            && anki.imageOcclusion
            && typeof anki.imageOcclusion.setup === "function"
        ) {
            anki.imageOcclusion.setup();
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _ioHiddenElements() {
        return Array.from(
            document.querySelectorAll(".cloze, .cloze-inactive")
        ).filter(function (el) {
            if (!(el instanceof HTMLDivElement) || !el.dataset.shape) {
                return false;
            }
            if (el.classList.contains("cloze")) {
                return true;
            }
            return el.classList.contains("cloze-inactive")
                && el.dataset.occludeinactive === "1";
        }).sort(function (a, b) {
            return _shapeOrder(
                {
                    ordinal: Number(a.dataset.ordinal || 0),
                    top: Number(a.dataset.top || 0),
                    left: Number(a.dataset.left || 0),
                },
                {
                    ordinal: Number(b.dataset.ordinal || 0),
                    top: Number(b.dataset.top || 0),
                    left: Number(b.dataset.left || 0),
                }
            );
        });
    }

    function _countIOHidden() {
        return _ioHiddenElements().length;
    }

    function _revealIOShape() {
        var els = _ioHiddenElements();
        var el = els[0];
        if (!el) return;
        el.className = "cloze-highlight";
        _rerenderIO();
    }

    function _textSpans(containerSelector) {
        return Array.from(
            document.querySelectorAll(containerSelector + " .cloze")
        ).filter(function (el) {
            return el instanceof HTMLSpanElement && !el.dataset.shape;
        });
    }

    function _allTextSpans() {
        return Array.from(document.querySelectorAll(".cloze")).filter(function (el) {
            return el instanceof HTMLSpanElement && !el.dataset.shape;
        });
    }

    function _splitTextSpans() {
        var text1 = _textSpans("#ar-text1");
        var text2 = _textSpans("#ar-text2");
        if (text1.length || text2.length) {
            return { text1: text1, text2: text2 };
        }

        var imageContainer = document.getElementById("image-occlusion-container");
        var all = _allTextSpans();
        if (!imageContainer || !all.length || typeof imageContainer.compareDocumentPosition !== "function") {
            return { text1: all, text2: [] };
        }

        var before = [];
        var after = [];
        all.forEach(function (span) {
            var relation = imageContainer.compareDocumentPosition(span);
            if (relation & 2) {
                before.push(span);
            } else if (relation & 4) {
                after.push(span);
            }
        });
        return { text1: before, text2: after };
    }

    function _text1Spans() {
        return _splitTextSpans().text1;
    }

    function _text2Spans() {
        return _splitTextSpans().text2;
    }

    function _renderFallbackPlaceholders(containerId, texts) {
        var container = document.getElementById(containerId);
        if (!(container instanceof HTMLDivElement)) return;
        if (!texts.length) return;
        if (_textSpans("#" + containerId).length) return;
        if (container.children.length || container.textContent.trim()) return;

        texts.forEach(function (text, idx) {
            var span = document.createElement("span");
            span.className = "cloze";
            span.dataset.cloze = text;
            span.textContent = "[...]";
            container.appendChild(span);
            if (idx < texts.length - 1) {
                container.appendChild(document.createTextNode(" "));
            }
        });
    }

    function _prepareTextFallbacks() {
        _renderFallbackPlaceholders("ar-text1", _text1Texts);
        _renderFallbackPlaceholders("ar-text2", _text2Texts);
    }

    function _revealSpan(span, fallbackText) {
        if (!span) return;
        var html = span.dataset.cloze;
        if (html == null || html === "") {
            html = fallbackText || "";
        }
        span.innerHTML = html;
        if (typeof MathJax !== "undefined") MathJax.typesetPromise([span]);
    }

    function _showAnswer() {
        _enabled = false;
        pycmd("ans");
    }

    function _safeOuterHTML(el) {
        return el && el.outerHTML ? el.outerHTML : null;
    }

    function _describeElement(el, idx) {
        return {
            index: idx,
            tag: el.tagName,
            className: el.className,
            textContent: el.textContent,
            innerHTML: el.innerHTML,
            outerHTML: _safeOuterHTML(el),
            dataset: Object.assign({}, el.dataset),
        };
    }

    function _collectSnapshot(label) {
        var body = document.body || document.documentElement;
        var allClozes = Array.from(
            document.querySelectorAll(".cloze, .cloze-inactive, .cloze-highlight")
        );
        return {
            label: label,
            timestamp: Date.now(),
            enabled: _enabled,
            phase: _phase,
            phaseIdx: _phaseIdx,
            ioHiddenTotal: _ioHiddenTotal,
            text1Texts: _text1Texts.slice(),
            text2Texts: _text2Texts.slice(),
            arText1: (document.getElementById("ar-text1") || {}).innerHTML || null,
            arText2: (document.getElementById("ar-text2") || {}).innerHTML || null,
            imageContainerHtml: _safeOuterHTML(document.getElementById("image-occlusion-container")),
            canvasHtml: _safeOuterHTML(document.getElementById("image-occlusion-canvas")),
            bodyHtml: body ? body.innerHTML : null,
            ioHiddenElements: _ioHiddenElements().map(_describeElement),
            text1Spans: _text1Spans().map(_describeElement),
            text2Spans: _text2Spans().map(_describeElement),
            allClozes: allClozes.map(_describeElement),
            ioSetup: {
                hasAnki: typeof anki !== "undefined",
                hasImageOcclusion: typeof anki !== "undefined" && !!anki.imageOcclusion,
                hasSetup:
                    typeof anki !== "undefined"
                    && !!anki.imageOcclusion
                    && typeof anki.imageOcclusion.setup === "function",
                setupSource:
                    typeof anki !== "undefined"
                    && !!anki.imageOcclusion
                    && typeof anki.imageOcclusion.setup === "function"
                        ? String(anki.imageOcclusion.setup).slice(0, 1000)
                        : null,
            },
        };
    }

    function _emitLog(label) {
        pycmd("arclozeioLog:" + encodeURIComponent(JSON.stringify(_collectSnapshot(label))));
    }

    // Advance past any empty phases. Returns true if all phases are done.
    function _skipEmptyPhases() {
        while (_phase <= 2) {
            var remaining;
            if (_phase === 0) {
                remaining = _text1Spans().length - _phaseIdx;
            } else if (_phase === 1) {
                if (_ioHiddenTotal === -1) _ioHiddenTotal = _countIOHidden();
                remaining = _ioHiddenTotal - _phaseIdx;
            } else {
                remaining = _text2Spans().length - _phaseIdx;
            }
            if (remaining > 0) return false;
            _phase++;
            _phaseIdx = 0;
        }
        return true;
    }

    // ── Public API ───────────────────────────────────────────────────────

    window.arclozeio = {
        dumpQuestionHtml: function () {
            var payload = _collectSnapshot("dump");
            payload.clozes = payload.allClozes;
            pycmd("arclozeioDump:" + encodeURIComponent(JSON.stringify(payload)));
        },

        init: function (payload) {
            _enabled = true;
            _text1Texts = (payload && payload.text1) || [];
            _text2Texts = (payload && payload.text2) || [];
            _prepareTextFallbacks();
            _phase = 0;
            _phaseIdx = 0;
            _ioHiddenTotal = -1;
            _emitLog("init:before-dump");
            requestAnimationFrame(function () {
                _emitLog("init:raf-before-dump");
                window.arclozeio.dumpQuestionHtml();
            });
            if (typeof setTimeout === "function") {
                setTimeout(function () {
                    _emitLog("init:timeout-before-dump");
                    window.arclozeio.dumpQuestionHtml();
                }, 300);
            }
        },

        disable: function () {
            _enabled = false;
        },

        revealNext: function () {
            _emitLog("reveal:start");
            if (_skipEmptyPhases()) {
                _emitLog("reveal:show-answer-immediate");
                _showAnswer();
                return;
            }

            if (_phase === 0) {
                var spans = _text1Spans();
                _revealSpan(spans[_phaseIdx], _text1Texts[_phaseIdx]);
                _phaseIdx++;
            } else if (_phase === 1) {
                _revealIOShape();
                _phaseIdx++;
            } else if (_phase === 2) {
                var spans2 = _text2Spans();
                _revealSpan(spans2[_phaseIdx], _text2Texts[_phaseIdx]);
                _phaseIdx++;
            }

            _emitLog("reveal:after-step");

            if (_skipEmptyPhases()) {
                // Wait for any pending canvas render before showing the answer.
                requestAnimationFrame(function () {
                    _emitLog("reveal:before-final-answer");
                    _showAnswer();
                });
            }
        },
    };
})();
