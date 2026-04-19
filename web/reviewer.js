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

    var _phase = 0; // 0=Text1, 1=IO, 2=Text2, 3=done
    var _phaseIdx = 0;

    // IO reveal state (mirrors the autoregressive-image-occlusion add-on)
    var _ioRevealed = 0;
    var _ioHiddenTotal = -1;
    var _ioLastConfig = null;
    var _origSetup = null;

    // ── IO shape filter ──────────────────────────────────────────────────

    function _shapeKey(s) {
        return s.ordinal + "," + Math.round(s.top * 1e4) + "," + Math.round(s.left * 1e4);
    }

    function _shapeOrder(a, b) {
        if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
        if (a.top !== b.top) return a.top - b.top;
        return a.left - b.left;
    }

    function _filterShapes(data) {
        if (_ioRevealed === 0) return null;

        var allHidden = data.activeShapes
            .concat(data.inactiveShapes.filter(function (s) { return s.occludeInactive; }))
            .sort(_shapeOrder);
        if (allHidden.length === 0) return null;

        var revealedKeys = {};
        for (var i = 0; i < Math.min(_ioRevealed, allHidden.length); i++) {
            revealedKeys[_shapeKey(allHidden[i])] = true;
        }

        var newHighlight = (data.highlightShapes || []).concat(
            data.activeShapes.filter(function (s) { return revealedKeys[_shapeKey(s)]; })
        );

        return {
            activeShapes: data.activeShapes.filter(function (s) {
                return !revealedKeys[_shapeKey(s)];
            }),
            inactiveShapes: data.inactiveShapes.filter(function (s) {
                return !revealedKeys[_shapeKey(s)];
            }),
            highlightShapes: newHighlight,
            properties: data.properties,
        };
    }

    function _rerenderIO() {
        if (_origSetup && typeof anki !== "undefined" && anki.imageOcclusion) {
            anki.imageOcclusion.setup(_ioLastConfig);
        }
    }

    // Install the wrapper once anki.imageOcclusion is loaded.
    (function _installIOWrapper() {
        function install() {
            if (typeof anki === "undefined" || !anki.imageOcclusion || !anki.imageOcclusion.setup) {
                return false;
            }
            if (anki.imageOcclusion.setup._arclozeioWrapped) return true;

            _origSetup = anki.imageOcclusion.setup;
            var wrapper = function (config) {
                _ioLastConfig = config || {};
                var userHook = _ioLastConfig.onWillDrawShapes;
                var wrapped = Object.assign({}, _ioLastConfig, {
                    onWillDrawShapes: function (data, ctx) {
                        var base = userHook ? (userHook(data, ctx) || data) : data;
                        return _filterShapes(base);
                    },
                });
                return _origSetup.call(this, wrapped);
            };
            wrapper._arclozeioWrapped = true;
            anki.imageOcclusion.setup = wrapper;
            anki.setupImageCloze = wrapper;
            return true;
        }
        if (!install()) {
            var iv = setInterval(function () {
                if (install()) clearInterval(iv);
            }, 50);
        }
    })();

    // ── Helpers ──────────────────────────────────────────────────────────

    // IO shape divs (as opposed to text-cloze spans) always have data-shape set.
    function _countIOHidden() {
        var count = 0;
        document.querySelectorAll(".cloze").forEach(function (el) {
            if (el instanceof HTMLDivElement && el.dataset.shape) count++;
        });
        document.querySelectorAll(".cloze-inactive").forEach(function (el) {
            if (
                el instanceof HTMLDivElement
                && el.dataset.shape
                && el.dataset.occludeinactive === "1"
            ) count++;
        });
        return count;
    }

    function _text1Spans() {
        return document.querySelectorAll("#ar-text1 .cloze");
    }

    function _text2Spans() {
        return document.querySelectorAll("#ar-text2 .cloze");
    }

    function _revealSpan(span, text) {
        if (!span) return;
        span.innerHTML = text;
        if (typeof MathJax !== "undefined") MathJax.typesetPromise([span]);
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
        init: function (payload) {
            _text1Texts = (payload && payload.text1) || [];
            _text2Texts = (payload && payload.text2) || [];
            _phase = 0;
            _phaseIdx = 0;
            _ioRevealed = 0;
            _ioHiddenTotal = -1;

            var t1 = document.getElementById("ar-text1");
            if (t1) t1.innerHTML = (payload && payload.text1Html) || "";
            var t2 = document.getElementById("ar-text2");
            if (t2) t2.innerHTML = (payload && payload.text2Html) || "";
        },

        revealNext: function () {
            if (_skipEmptyPhases()) {
                pycmd("arShowAnswer");
                return;
            }

            if (_phase === 0) {
                var spans = _text1Spans();
                _revealSpan(spans[_phaseIdx], _text1Texts[_phaseIdx]);
                _phaseIdx++;
            } else if (_phase === 1) {
                _ioRevealed++;
                _phaseIdx++;
                _rerenderIO();
            } else if (_phase === 2) {
                var spans2 = _text2Spans();
                _revealSpan(spans2[_phaseIdx], _text2Texts[_phaseIdx]);
                _phaseIdx++;
            }

            if (_skipEmptyPhases()) {
                // Wait for any pending canvas render before showing the answer.
                requestAnimationFrame(function () {
                    pycmd("arShowAnswer");
                });
            }
        },
    };
})();
