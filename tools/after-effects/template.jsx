/*
 * Evolution24 Properties: the animated logo, built in After Effects.
 *
 * TO USE: in After Effects, File > Scripts > Run Script File..., and choose this file.
 * It starts a new project, builds the comps below, and saves the project as
 * "Evolution24 Logo.aep" in the same folder as this file. (If After Effects says
 * scripts may not write files: Settings > Scripting & Expressions > tick "Allow
 * Scripts to Write Files and Access Network", then run it again.)
 *
 * WHAT IT BUILDS, in a folder "Evolution24 Logo":
 *   Evolution24 Intro 16x9         1920x1080, 60 fps. The website's intro as on a
 *                                  laptop: the bars rise one by one from the baseline,
 *                                  the letters settle in, the line fills, and the
 *                                  curtain lifts to reveal what is underneath (2.95 s).
 *   Evolution24 Intro 9x16         1080x1920. The same intro in its phone timing (1.75 s).
 *   Evolution24 Lockup Build 16x9  1920x1080, transparent. The header logo's build.
 *   Precomps                       each intro before its curtain. Its ink background is
 *                                  a layer of its own: switch it off for a transparent build.
 *
 * Every bar and letter is a shape layer of its own, keyframed with the website's
 * timing, and its easing curves converted exactly into speed and influence. Each logo
 * hangs from a null: move or scale the null and everything follows.
 * Colours: ink #151613, tan #debb92, cream #e5e6d3.
 */
(function evolution24Logo() {
    var COLORS = /*@COLORS@*/;
    var EASE = /*@EASE@*/;              // the website's --ease, cubic-bezier(.2, .7, .1, 1)
    var EASE_IN_OUT = /*@EASE_IN_OUT@*/;       // its --ease-in-out, cubic-bezier(.7, 0, .2, 1)
    var FPS = /*@FPS@*/;
    var BARS = /*@BARS@*/;
    var LETTERS = /*@LETTERS@*/;
    var LOCKUP = /*@LOCKUP@*/;
    var COMPS = /*@COMPS@*/;
    // After Effects' Gaussian Blur spreads by 0.3 x Blurriness (one standard deviation, in pixels).
    var BLURRINESS_PER_PIXEL = 1 / 0.3;

    /* ---- shapes ------------------------------------------------------------------- */

    function shapeOf(s) {
        var shape = new Shape();
        var v = [], ins = [], outs = [], k;
        for (k = 0; k < s.v.length; k += 2) {
            v.push([s.v[k], s.v[k + 1]]);
            ins.push([s.i[k], s.i[k + 1]]);
            outs.push([s.o[k], s.o[k + 1]]);
        }
        shape.vertices = v;
        shape.inTangents = ins;
        shape.outTangents = outs;
        shape.closed = true;
        return shape;
    }

    // A shape layer holding one named group; returns the layer and the group's contents.
    function addShapeLayer(comp, name) {
        var layer = comp.layers.addShape();
        layer.name = name;
        var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        group.name = name;
        return { layer: layer, items: group.property("ADBE Vectors Group") };
    }

    function addFill(items, color, opacity) {
        var fill = items.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue([color[0], color[1], color[2], 1]);
        fill.property("ADBE Vector Fill Opacity").setValue(opacity);
    }

    // One bar or letter: its outlines (a letter like O has two) under one fill.
    function addPiece(comp, piece) {
        var s = addShapeLayer(comp, piece.name);
        for (var k = 0; k < piece.shapes.length; k++) {
            s.items.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(shapeOf(piece.shapes[k]));
        }
        addFill(s.items, COLORS[piece.fill], 100);
        return s.layer;
    }

    function addRect(comp, name, w, h, color, opacity) {
        var s = addShapeLayer(comp, name);
        s.items.addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([w, h]);
        addFill(s.items, color, opacity);
        return s.layer;
    }

    /* ---- transforms and keyframes ----------------------------------------------- */

    function xf(layer, matchName) {
        return layer.property("ADBE Transform Group").property(matchName);
    }

    function place(layer, anchor, position, scale) {
        xf(layer, "ADBE Anchor Point").setValue(anchor);
        xf(layer, "ADBE Position").setValue(position);
        xf(layer, "ADBE Scale").setValue([scale, scale]);
    }

    // A null that maps its children's coordinates the way an SVG group transform does.
    function addNull(comp, name, parent, g) {
        var layer = comp.layers.addNull(comp.duration);
        layer.name = name;
        if (parent) {
            layer.parent = parent;
        }
        place(layer, g.anchor, g.position, g.scale);
        return layer;
    }

    function dimensions(prop) {
        var v = prop.value;
        return (v instanceof Array) ? v.length : 1;
    }

    // Two keyframes from v0 at t0 to v1 at t1, eased by a CSS cubic-bezier(x1, y1, x2, y2).
    // The curve becomes After Effects' speed and influence exactly: influence is the
    // handle's share of the time, and speed its slope, per dimension (spatial properties
    // take one speed, along the path).
    function animate(prop, t0, v0, t1, v1, curve) {
        prop.setValueAtTime(t0, v0);
        prop.setValueAtTime(t1, v1);
        var k0 = prop.nearestKeyIndex(t0);
        var k1 = prop.nearestKeyIndex(t1);
        var span = t1 - t0;
        var a = (v0 instanceof Array) ? v0 : [v0];
        var b = (v1 instanceof Array) ? v1 : [v1];
        var n = prop.isSpatial ? 1 : dimensions(prop);
        var outs = [], ins = [], d, change, dist = 0;
        if (prop.isSpatial) {
            for (d = 0; d < a.length; d++) {
                dist += (b[d] - a[d]) * (b[d] - a[d]);
            }
            dist = Math.sqrt(dist);
        }
        for (d = 0; d < n; d++) {
            change = prop.isSpatial ? dist : ((d < a.length && d < b.length) ? b[d] - a[d] : 0);
            outs.push(new KeyframeEase(curve[0] > 0 ? curve[1] / curve[0] * change / span : 0, Math.max(0.1, curve[0] * 100)));
            ins.push(new KeyframeEase(curve[2] < 1 ? (1 - curve[3]) / (1 - curve[2]) * change / span : 0, Math.max(0.1, (1 - curve[2]) * 100)));
        }
        prop.setInterpolationTypeAtKey(k0, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        prop.setInterpolationTypeAtKey(k1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        prop.setTemporalEaseAtKey(k0, outs, outs);
        prop.setTemporalEaseAtKey(k1, ins, ins);
        if (prop.isSpatial) {
            var zero = [];
            for (d = 0; d < dimensions(prop); d++) {
                zero.push(0);
            }
            prop.setSpatialTangentsAtKey(k0, zero, zero);        // a straight path, as CSS moves
            prop.setSpatialTangentsAtKey(k1, zero, zero);
        }
    }

    // The letters' blur, which on the website is in the logo's own units: it grows with the logo.
    function blurIn(layer, t0, t1, blurriness, logoScale) {
        var effect = layer.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        var prop = effect.property("ADBE Gaussian Blur 2-0001");
        animate(prop, t0, blurriness, t1, 0, EASE);
        prop.expression = "// grows with the logo's null, as the blur does on the website\n" +
            "var s = thisLayer.hasParent ? Math.abs(thisLayer.parent.transform.scale[0]) : " + logoScale + ";\n" +
            "value * s / " + logoScale + ";";
    }

    /* ---- the logo ------------------------------------------------------------------ */

    // Each bar grows from the middle of its base; each letter rises from below as it fades in.
    function buildLogo(comp, spec, parentOf, pixelsPerUnit) {
        var i, p, layer, ax, ay, t0, t1;
        for (i = 0; i < BARS.length; i++) {
            p = BARS[i];
            layer = addPiece(comp, p);
            layer.parent = parentOf(p);
            ax = (p.box[0] + p.box[2]) / 2;
            ay = p.box[3];
            place(layer, [ax, ay], [ax, ay], 100);
            t0 = spec.bar.delay + spec.bar.step * i;
            t1 = t0 + spec.bar.dur;
            animate(xf(layer, "ADBE Scale"), t0, [100, 0], t1, [100, 100], EASE);
            if (spec.bar.fade) {
                animate(xf(layer, "ADBE Opacity"), t0, 0, t0 + spec.bar.dur * spec.bar.fade, 100, EASE);
            }
        }
        for (i = 0; i < LETTERS.length; i++) {
            p = LETTERS[i];
            layer = addPiece(comp, p);
            layer.parent = parentOf(p);
            ax = (p.box[0] + p.box[2]) / 2;
            ay = p.box[3];
            place(layer, [ax, ay], [ax, ay], 100);
            t0 = spec.word.delay + spec.word.step * i;
            t1 = t0 + spec.word.dur;
            animate(xf(layer, "ADBE Position"), t0, [ax, ay + spec.word.rise * (p.box[3] - p.box[1])], t1, [ax, ay], EASE);
            animate(xf(layer, "ADBE Opacity"), t0, 0, t1, 100, EASE);
            if (spec.word.blur > 0) {
                blurIn(layer, t0, t1, spec.word.blur * pixelsPerUnit * BLURRINESS_PER_PIXEL, spec.logoWidth / 10);
            }
        }
    }

    function useAsMatte(layer, matte) {
        if (typeof layer.setTrackMatte === "function") {
            layer.setTrackMatte(matte, TrackMatteType.ALPHA);      // After Effects 2023 and later
        } else {
            matte.moveBefore(layer);                                // earlier: the matte sits just above
            layer.trackMatteType = TrackMatteType.ALPHA;
        }
        matte.enabled = false;
    }

    // The overlay before its curtain: ink, the logo on a null, and the line along the bottom.
    function introContents(spec, folder) {
        var comp = app.project.items.addComp(spec.name + " contents", spec.w, spec.h, 1, spec.duration, FPS);
        comp.parentFolder = folder;
        comp.bgColor = COLORS.ink;
        comp.layers.addSolid(COLORS.ink, "Background", spec.w, spec.h, 1, spec.duration);
        var logo = addNull(comp, "Logo (move and scale me)", null,
            { anchor: [500, 205], position: [spec.w / 2, spec.h / 2], scale: spec.logoWidth / 10 });
        buildLogo(comp, spec, function () { return logo; }, spec.logoWidth / 1000);
        var line = spec.line;
        var y = line.top + line.h / 2;
        var track = addRect(comp, "Line", line.w, line.h, COLORS.cream, 16);
        place(track, [0, 0], [spec.w / 2, y], 100);
        var fill = addRect(comp, "Line fill", line.w, line.h, COLORS.tan, 100);
        place(fill, [-line.w / 2, 0], [spec.w / 2 - line.w / 2, y], 100);
        animate(xf(fill, "ADBE Scale"), line.delay, [0, 100], line.delay + line.dur, [100, 100], EASE_IN_OUT);
        return comp;
    }

    // The intro: its contents, with a curtain that lifts from the bottom edge to the top.
    function intro(spec, folder, precomps) {
        var inner = introContents(spec, precomps);
        var comp = app.project.items.addComp(spec.name, spec.w, spec.h, 1, spec.duration, FPS);
        comp.parentFolder = folder;
        comp.bgColor = COLORS.paper;                                // shows through once the curtain is up
        var layer = comp.layers.add(inner);
        layer.name = "Intro";
        var matte = addRect(comp, "Curtain (matte)", spec.w, spec.h, [1, 1, 1], 100);
        place(matte, [0, -spec.h / 2], [spec.w / 2, 0], 100);
        var c = spec.curtain;
        animate(xf(matte, "ADBE Scale"), c.delay, [100, 100], c.delay + c.dur, [100, 0], EASE_IN_OUT);
        useAsMatte(layer, matte);
        return comp;
    }

    // The header lockup: the mark on the left, the two words stacked to its right.
    function lockup(spec, folder) {
        var comp = app.project.items.addComp(spec.name, spec.w, spec.h, 1, spec.duration, FPS);
        comp.parentFolder = folder;
        comp.bgColor = COLORS.ink;                                  // for viewing; it renders transparent
        var all = addNull(comp, "Lockup (move and scale me)", null,
            { anchor: [LOCKUP.size[0] / 2, LOCKUP.size[1] / 2], position: [spec.w / 2, spec.h / 2], scale: spec.logoWidth / LOCKUP.size[0] * 100 });
        var mark = addNull(comp, "Mark", all, LOCKUP.mark);
        var line1 = addNull(comp, "EVOLUTION24", all, LOCKUP.line1);
        var line2 = addNull(comp, "PROPERTIES", all, LOCKUP.line2);
        buildLogo(comp, spec, function (p) { return p.line ? (p.line === 1 ? line1 : line2) : mark; }, 0);
        return comp;
    }

    function main() {
        if (!app.newProject()) {
            return;                                                 // the save dialog was cancelled
        }
        app.beginUndoGroup("Evolution24 logo");
        var folder = app.project.items.addFolder("Evolution24 Logo");
        var precomps = app.project.items.addFolder("Precomps");
        precomps.parentFolder = folder;
        var first = null, comp, i;
        for (i = 0; i < COMPS.length; i++) {
            comp = COMPS[i].layout === "stacked" ? intro(COMPS[i], folder, precomps) : lockup(COMPS[i], folder);
            if (!first) {
                first = comp;
            }
        }
        app.endUndoGroup();
        first.openInViewer();
        var target = new File(new File($.fileName).parent.fsName + "/Evolution24 Logo.aep");
        try {
            app.project.save(target);
            alert("Evolution24 logo: built " + COMPS.length + " comps and saved the project as\n" + target.fsName);
        } catch (e) {
            alert("Evolution24 logo: built " + COMPS.length + " comps. Save it with File > Save As.\n(" + e.message + ")");
        }
    }

    main();
}());
