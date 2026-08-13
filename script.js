(function(){
  "use strict";

  var STORAGE_KEY = "mindmap_proto_state_v1";
  var MODE_KEY = "mindmap_proto_mode_v1";
  var R0 = 240, RSTEP = 210, NODE_GAP = 26;
  var lastSizes = {};
  var PALETTE = ['#f5a623','#4fc3f7','#81c784','#ba68c8','#ff8a65','#4dd0e1','#f06292','#9575cd','#aed581','#ffd54f'];

  var state = null;
  var mode = localStorage.getItem(MODE_KEY) || 'edit';

  function uid(){ return 'n' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

  // Icons are vendored locally in icons.js (no CDN, works offline).
  function icon(name){
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  function iconBtn(name, title, extraClass){
    var b = document.createElement('button');
    if(extraClass) b.className = extraClass;
    b.title = title;
    b.appendChild(icon(name));
    return b;
  }

  // Static icons declared in the HTML as <i data-lucide="..."> get swapped
  // for real inline SVGs once at boot (mirrors what lucide.createIcons()
  // used to do, minus the runtime/CDN dependency).
  function hydrateStaticIcons(){
    Array.prototype.forEach.call(document.querySelectorAll('i[data-lucide]'), function(el){
      el.replaceWith(icon(el.getAttribute('data-lucide')));
    });
  }

  function blankState(){
    var rootId = uid();
    var nodes = {};
    nodes[rootId] = { id: rootId, parentId: null, label: "Start", text: "", children: [] };
    return { rootId: rootId, nodes: nodes, focusedId: null, previewsOn: true };
  }

  // Picks the palette entry that the existing top-level branches use least
  // (so: any unused color first, and only once all ten are taken does it
  // start doubling up, evenly). Indexing the palette by child count instead
  // — the old approach — collided as soon as a branch was deleted or
  // reparented, since the count walks backwards over colors that are still
  // in use: 5 branches wearing colors 0-4, delete the middle one, and the
  // next branch added computes index 4 and repeats an in-use color.
  function nextBranchColor(excludeId){
    var used = {};
    state.nodes[state.rootId].children.forEach(function(cid){
      if(cid === excludeId) return;
      var c = state.nodes[cid];
      if(c && c.color) used[c.color] = (used[c.color] || 0) + 1;
    });
    var best = PALETTE[0], bestCount = Infinity;
    PALETTE.forEach(function(col){
      var n = used[col] || 0;
      if(n < bestCount){ bestCount = n; best = col; }
    });
    return best;
  }

  function ensureBranchColors(){
    var root = state.nodes[state.rootId];
    root.children.forEach(function(cid){
      var c = state.nodes[cid];
      if(c && !c.color) c.color = nextBranchColor(cid);
    });
  }

  function load(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return blankState();
      var parsed = JSON.parse(raw);
      if(!parsed.rootId || !parsed.nodes) return blankState();
      parsed.focusedId = null;
      if(typeof parsed.previewsOn !== 'boolean') parsed.previewsOn = true;
      return parsed;
    }catch(e){ return blankState(); }
  }

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rootId: state.rootId, nodes: state.nodes, previewsOn: state.previewsOn }));
  }

  // ---------- layout ----------
  function leafCount(node){
    if(!node.children.length) return 1;
    var s = 0;
    for(var i=0;i<node.children.length;i++) s += leafCount(state.nodes[node.children[i]]);
    return s;
  }

  function sizeOf(sizes, id){
    return (sizes && sizes[id]) || { width:200, height:100 };
  }

  // Half-diagonal of a node's box: the radius of the smallest circle that
  // fully encloses it, regardless of which way it's facing. Used as an
  // angle-independent stand-in for the box's true footprint — a node
  // positioned along the x-axis is exposed by its width, one along the
  // y-axis by its height, and this covers both without needing per-angle
  // rectangle-projection math.
  function footprint(sizes, id){
    var s = sizeOf(sizes, id);
    return Math.sqrt((s.width/2)*(s.width/2) + (s.height/2)*(s.height/2));
  }

  // Node boxes have variable width/height (text length, notes previews), so a
  // pure angle/radius split by leaf count can pack boxes closer than their
  // rendered size allows. Given each node's real measured size (from the last
  // render, or a rough default before the first one), each child gets its own
  // radius — just far enough to clear the parent's footprint and to keep its
  // own footprint inside its angular slice (using the true perpendicular
  // distance to the slice boundary, `radius*sin(halfAngle)`, not a linear
  // stand-in) — rather than every sibling being pushed out to match whichever
  // one needs the most room, which is what made small leaf nodes drift far
  // from their parent just because a content-heavy sibling needed space.
  function computeLayout(sizes){
    var positions = {};
    var root = state.nodes[state.rootId];
    positions[root.id] = { x:0, y:0 };

    function layoutChildren(node, startAngle, endAngle, parentRadius, parentFootprint, minStep){
      var children = node.children.map(function(id){ return state.nodes[id]; }).filter(Boolean);
      if(!children.length) return;
      var total = 0;
      children.forEach(function(c){ total += leafCount(c); });

      var span = endAngle - startAngle;
      var angles = children.map(function(c){ return span * (leafCount(c)/total); });

      var a = startAngle;
      children.forEach(function(child, i){
        var span_i = angles[i];
        var mid = a + span_i/2;
        var childFootprint = footprint(sizes, child.id);

        var radius = Math.max(parentRadius + minStep, parentRadius + parentFootprint + childFootprint + NODE_GAP);
        var halfAngle = Math.min(span_i/2, Math.PI/2);
        var angularRadius = (childFootprint + NODE_GAP/2) / Math.max(Math.sin(halfAngle), 0.0001);
        radius = Math.max(radius, angularRadius);

        positions[child.id] = { x: Math.cos(mid)*radius, y: Math.sin(mid)*radius };
        layoutChildren(child, a, a+span_i, radius, childFootprint, RSTEP);
        a += span_i;
      });
    }
    layoutChildren(root, 0, Math.PI*2, 0, footprint(sizes, root.id), R0);
    return positions;
  }

  function pathToRoot(id){
    var path = [];
    var cur = state.nodes[id];
    while(cur){ path.push(cur.id); cur = cur.parentId ? state.nodes[cur.parentId] : null; }
    return path;
  }

  function getBranchColor(id){
    if(id === state.rootId) return null;
    var node = state.nodes[id];
    while(node && node.parentId && node.parentId !== state.rootId){
      node = state.nodes[node.parentId];
    }
    return (node && node.color) || '#8b93a3';
  }

  function isDescendantOf(ancestorId, candidateId){
    if(ancestorId === candidateId) return true;
    var node = state.nodes[ancestorId];
    for(var i=0;i<node.children.length;i++){
      if(isDescendantOf(node.children[i], candidateId)) return true;
    }
    return false;
  }

  // ---------- pan / zoom / centering ----------
  var canvas = document.getElementById('canvas');
  var world = document.getElementById('world');
  var svg = document.getElementById('edges');
  var panX=0, panY=0, scale=1;

  function applyTransform(){
    world.style.transform = 'translate('+panX+'px,'+panY+'px) scale('+scale+')';
  }

  function animateTo(px,py,sc,animate){
    panX=px; panY=py; scale=sc;
    if(animate){
      world.classList.add('animate');
      applyTransform();
      setTimeout(function(){ world.classList.remove('animate'); }, 400);
    }else{
      world.classList.remove('animate');
      applyTransform();
    }
  }

  // Fits the focused node's whole highlighted path (root down to it) into
  // the viewport, zooming in as needed, instead of just re-centering it at
  // whatever scale happened to be active — a lone leaf node used to stay
  // tiny in the middle of a mostly-empty screen after being focused. Direct
  // children are included too (but not grandchildren), so zooming in on a
  // node never zooms its own children off-screen.
  function fitActiveToView(id, animate){
    var positions = computeLayout(lastSizes);
    var focusNode = state.nodes[id];
    var group = pathToRoot(id).concat(focusNode ? focusNode.children : []);
    var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    group.forEach(function(pid){
      var p = positions[pid];
      if(!p) return;
      var s = sizeOf(lastSizes, pid);
      minX = Math.min(minX, p.x - s.width/2);
      maxX = Math.max(maxX, p.x + s.width/2);
      minY = Math.min(minY, p.y - s.height/2);
      maxY = Math.max(maxY, p.y + s.height/2);
    });
    if(minX===Infinity) return;
    var pad = 60;
    var w = (maxX-minX)+pad*2, h = (maxY-minY)+pad*2;
    var cw = Math.max(canvas.clientWidth,1), ch = Math.max(canvas.clientHeight,1);
    var newScale = Math.max(0.25, Math.min(2.5, Math.min(cw/w, ch/h)));
    var cx = (minX+maxX)/2, cy = (minY+maxY)/2;
    animateTo(cw/2 - cx*newScale, ch/2 - cy*newScale, newScale, animate);
  }

  function fitToView(animate){
    var positions = computeLayout(lastSizes);
    var ids = Object.keys(positions);
    var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    ids.forEach(function(id){
      var p = positions[id];
      var s = sizeOf(lastSizes, id);
      minX=Math.min(minX,p.x-s.width/2); maxX=Math.max(maxX,p.x+s.width/2);
      minY=Math.min(minY,p.y-s.height/2); maxY=Math.max(maxY,p.y+s.height/2);
    });
    var pad = 60;
    var w = (maxX-minX)+pad*2, h = (maxY-minY)+pad*2;
    var cw = Math.max(canvas.clientWidth,1), ch = Math.max(canvas.clientHeight,1);
    var newScale = Math.max(0.25, Math.min(2.5, Math.min(cw/w, ch/h)));
    var cx = (minX+maxX)/2, cy = (minY+maxY)/2;
    animateTo(cw/2 - cx*newScale, ch/2 - cy*newScale, newScale, animate);
  }

  // ---------- rendering ----------
  function reachableIds(){
    var out = [];
    function walk(id){
      var node = state.nodes[id];
      if(!node) return;
      out.push(id);
      node.children.forEach(walk);
    }
    walk(state.rootId);
    return out;
  }

  function render(){
    var activeSet = {};
    var childSet = {};
    if(state.focusedId && state.nodes[state.focusedId]){
      pathToRoot(state.focusedId).forEach(function(id){ activeSet[id] = true; });
      state.nodes[state.focusedId].children.forEach(function(id){ childSet[id] = true; });
    }

    Array.prototype.slice.call(world.querySelectorAll('.node')).forEach(function(n){ n.remove(); });
    svg.innerHTML = '';

    var ids = reachableIds();
    var els = {};
    var positions = {};

    ids.forEach(function(id){
      var node = state.nodes[id];
      var isRoot = id===state.rootId;
      var color = getBranchColor(id);
      var plainText = (node.text||'').replace(/<[^>]*>/g,' ').trim();

      var el = document.createElement('div');
      el.className = 'node' + (isRoot ? ' root' : '');
      el.dataset.id = id;

      if(state.focusedId){
        if(activeSet[id]){
          if(!isRoot){
            el.style.boxShadow = '0 0 0 3px '+color+'55, 0 10px 26px rgba(0,0,0,.5)';
            el.style.borderColor = color;
            el.style.transform = 'translate(-50%,-50%) scale(1.05)';
          }
        }else if(childSet[id]){
          el.classList.add('secondary');
          el.style.boxShadow = '0 0 0 2px '+color+'33, 0 8px 20px rgba(0,0,0,.4)';
          el.style.borderColor = color+'99';
        }else{
          el.classList.add('dim');
        }
      }

      var labelRow = document.createElement('div');
      labelRow.className = 'label-row';
      if(isRoot){
        var flag = icon('compass');
        flag.setAttribute('class', 'root-icon');
        labelRow.appendChild(flag);
      }else{
        var dot = document.createElement('span');
        dot.className = 'dot';
        el.style.setProperty('--branch-color', color);
        labelRow.appendChild(dot);
      }
      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = node.label;
      labelRow.appendChild(label);
      if(plainText && !state.previewsOn){
        var hasNotes = icon('file-text');
        hasNotes.setAttribute('class', 'has-notes-icon');
        hasNotes.title = 'Has notes';
        labelRow.appendChild(hasNotes);
      }
      el.appendChild(labelRow);

      if(state.previewsOn && plainText){
        var prev = document.createElement('div');
        prev.className = 'preview';
        prev.textContent = plainText;
        el.appendChild(prev);
      }

      if(mode === 'edit'){
        var controls = document.createElement('div');
        controls.className = 'controls';

        var btnAdd = iconBtn('plus', 'Add branch');
        btnAdd.addEventListener('click', function(e){ e.stopPropagation(); addChild(id); });
        controls.appendChild(btnAdd);

        var btnOpen = iconBtn('maximize-2', 'Open big-text editor');
        btnOpen.addEventListener('click', function(e){ e.stopPropagation(); openEditor(id); });
        controls.appendChild(btnOpen);

        if(!isRoot){
          var btnDel = iconBtn('trash-2', 'Delete branch', 'danger trashRight');
          btnDel.addEventListener('click', function(e){
            e.stopPropagation();
            if(confirm('Delete "'+node.label+'" and everything under it?')) deleteNode(id);
          });
          controls.appendChild(btnDel);
        }

        el.appendChild(controls);

        label.addEventListener('dblclick', function(e){
          e.preventDefault();
          e.stopPropagation();
          startEditLabel(el, node);
        });

        if(!isRoot){
          el.addEventListener('mousedown', function(e){
            if(e.button !== 0) return;
            if(e.target.closest('.controls')) return;
            if(label.isContentEditable) return;
            dragNode = { id:id, el:el, startX:e.clientX, startY:e.clientY, active:false, fromPos:positions[id], targetId:null };
          });
        }
      }

      el.addEventListener('click', function(e){
        if(suppressNextClick){ suppressNextClick = false; return; }
        onNodeClick(id);
      });
      el.addEventListener('contextmenu', function(e){
        e.preventDefault();
        e.stopPropagation();
        openNotesFor(id);
      });

      world.appendChild(el);
      els[id] = el;
    });

    var sizes = {};
    ids.forEach(function(id){
      var el = els[id];
      sizes[id] = { width: el.offsetWidth, height: el.offsetHeight };
    });
    lastSizes = sizes;

    var computed = computeLayout(sizes);
    ids.forEach(function(id){ positions[id] = computed[id]; });

    ids.forEach(function(id){
      var pos = positions[id];
      var el = els[id];
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
    });

    ids.forEach(function(id){
      var node = state.nodes[id];
      if(!node.parentId) return;
      var p = positions[node.parentId], c = positions[id];
      if(!p || !c) return;
      var path = document.createElementNS('http://www.w3.org/2000/svg','path');
      var mx = (p.x + c.x)/2, my = (p.y + c.y)/2;
      path.setAttribute('d', 'M '+p.x+' '+p.y+' Q '+mx+' '+my+' '+c.x+' '+c.y);
      path.style.stroke = getBranchColor(id);
      if(state.focusedId){
        var cls = (activeSet[id] && activeSet[node.parentId]) ? 'active'
          : (node.parentId === state.focusedId) ? 'secondary' : 'dim';
        path.setAttribute('class', cls);
      }
      svg.appendChild(path);
    });
  }

  function focusAndCenter(id, animate){
    state.focusedId = id;
    render();
    fitActiveToView(id, animate);
  }

  function onNodeClick(id){
    if(state.focusedId === id) return;
    focusAndCenter(id, true);
  }

  function openNotesFor(id){
    var node = state.nodes[id];
    if(state.focusedId !== id) focusAndCenter(id, true);
    if(mode === 'edit'){
      openEditor(id);
    }else{
      var plain = (node.text||'').replace(/<[^>]*>/g,'').trim();
      if(plain) openViewer(id);
    }
  }

  function startEditLabel(el, node){
    var labelEl = el.querySelector('.label');
    labelEl.contentEditable = 'true';
    // Deferred so it runs after the browser's native double-click word
    // selection, which would otherwise override our select-everything.
    setTimeout(function(){
      labelEl.focus();
      document.execCommand('selectAll', false, null);
    }, 0);
    function commit(){
      labelEl.contentEditable = 'false';
      node.label = labelEl.textContent.trim() || 'Untitled';
      labelEl.removeEventListener('blur', commit);
      labelEl.removeEventListener('keydown', onKey);
      save();
      render();
    }
    function onKey(e){
      if(e.key === 'Enter'){ e.preventDefault(); labelEl.blur(); }
      if(e.key === 'Escape'){ e.preventDefault(); labelEl.textContent = node.label; labelEl.blur(); }
    }
    labelEl.addEventListener('blur', commit);
    labelEl.addEventListener('keydown', onKey);
  }

  function addChild(parentId){
    var parent = state.nodes[parentId];
    var id = uid();
    var newNode = { id:id, parentId:parentId, label:'New idea', text:'', children:[] };
    if(parentId === state.rootId){
      newNode.color = nextBranchColor(id);
    }
    state.nodes[id] = newNode;
    parent.children.push(id);
    save();
    focusAndCenter(id, true);
    var el = world.querySelector('.node[data-id="'+id+'"]');
    if(el) startEditLabel(el, newNode);
  }

  function deleteNode(id){
    var node = state.nodes[id];
    if(!node || !node.parentId) return;
    var parent = state.nodes[node.parentId];
    parent.children = parent.children.filter(function(c){ return c!==id; });
    (function removeSubtree(nid){
      var n = state.nodes[nid];
      if(!n) return;
      n.children.slice().forEach(removeSubtree);
      delete state.nodes[nid];
    })(id);
    if(state.focusedId && !state.nodes[state.focusedId]) state.focusedId = null;
    save();
    render();
  }

  function reparentNode(id, newParentId){
    var node = state.nodes[id];
    if(!node || node.parentId === newParentId) return;
    var oldParent = state.nodes[node.parentId];
    oldParent.children = oldParent.children.filter(function(c){ return c !== id; });
    var newParent = state.nodes[newParentId];
    if(newParentId === state.rootId){
      node.color = nextBranchColor(id);
    }else{
      delete node.color;
    }
    newParent.children.push(id);
    node.parentId = newParentId;
    save();
    focusAndCenter(id, true);
  }

  // ---------- drag a branch onto another node to reparent it ----------
  var dragNode = null; // {id, el, startX, startY, active, fromPos, targetId}
  var dragTargetEl = null;
  var dragLineEl = null;
  var suppressNextClick = false;

  function screenToWorld(clientX, clientY){
    var rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - panX) / scale, y: (clientY - rect.top - panY) / scale };
  }

  function setDragTarget(el){
    if(dragTargetEl === el) return;
    if(dragTargetEl) dragTargetEl.classList.remove('drop-target');
    dragTargetEl = el;
    if(dragTargetEl) dragTargetEl.classList.add('drop-target');
  }

  function endDrag(){
    if(dragLineEl){ dragLineEl.remove(); dragLineEl = null; }
    setDragTarget(null);
    canvas.classList.remove('reparenting');
    if(dragNode) dragNode.el.classList.remove('dragSource');
    dragNode = null;
  }

  window.addEventListener('mousemove', function(e){
    if(!dragNode) return;
    var dx = e.clientX - dragNode.startX, dy = e.clientY - dragNode.startY;
    if(!dragNode.active){
      if(dx*dx + dy*dy < 36) return; // ~6px threshold before this counts as a drag, not a click
      dragNode.active = true;
      dragNode.el.classList.add('dragSource');
      canvas.classList.add('reparenting');
      dragLineEl = document.createElementNS('http://www.w3.org/2000/svg','line');
      dragLineEl.setAttribute('class','dragLine');
      svg.appendChild(dragLineEl);
    }
    var to = screenToWorld(e.clientX, e.clientY);
    dragLineEl.setAttribute('x1', dragNode.fromPos.x);
    dragLineEl.setAttribute('y1', dragNode.fromPos.y);
    dragLineEl.setAttribute('x2', to.x);
    dragLineEl.setAttribute('y2', to.y);

    var elUnder = document.elementFromPoint(e.clientX, e.clientY);
    var targetNodeEl = elUnder ? elUnder.closest('.node') : null;
    var targetId = targetNodeEl ? targetNodeEl.dataset.id : null;
    var valid = targetId && targetId !== dragNode.id && !isDescendantOf(dragNode.id, targetId);
    setDragTarget(valid ? targetNodeEl : null);
    dragNode.targetId = valid ? targetId : null;
  });

  window.addEventListener('mouseup', function(){
    if(!dragNode) return;
    var wasActive = dragNode.active;
    var draggedId = dragNode.id;
    var targetId = dragNode.targetId;
    endDrag();
    if(wasActive){
      suppressNextClick = true;
      setTimeout(function(){ suppressNextClick = false; }, 0);
      if(targetId) reparentNode(draggedId, targetId);
    }
  });

  // ---------- pan & zoom (manual) ----------
  var isPanning=false, lastX=0, lastY=0, moved=0;

  canvas.addEventListener('mousedown', function(e){
    if(e.target.closest('.node')) return;
    isPanning = true; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    canvas.classList.add('panning');
  });
  window.addEventListener('mousemove', function(e){
    if(!isPanning) return;
    var dx = e.clientX-lastX, dy = e.clientY-lastY;
    panX += dx; panY += dy;
    moved += Math.abs(dx)+Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    world.classList.remove('animate');
    applyTransform();
  });
  window.addEventListener('mouseup', function(e){
    if(!isPanning) return;
    isPanning = false;
    canvas.classList.remove('panning');
    if(moved < 4 && !e.target.closest('.node')){
      state.focusedId = null;
      render();
      fitToView(true);
    }
  });
  canvas.addEventListener('wheel', function(e){
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.1 : 0.9;
    var newScale = Math.min(2.5, Math.max(0.25, scale*factor));
    world.classList.remove('animate');
    panX = px - (px - panX) * (newScale/scale);
    panY = py - (py - panY) * (newScale/scale);
    scale = newScale;
    applyTransform();
  }, { passive:false });

  var resizeTimer;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      if(state.focusedId) fitActiveToView(state.focusedId, false);
      else fitToView(false);
    }, 150);
  });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      if(dragNode){ endDrag(); }
      else if(overlay.classList.contains('open')) closeEditor(true);
      else if(viewerOverlay.classList.contains('open')) closeViewer();
      else if(state.focusedId){ state.focusedId = null; render(); fitToView(true); }
    }
  });

  // ---------- edit-mode notes editor ----------
  var editingNodeId = null;
  var HL_COLOR = '#8a6a12';
  var overlay = document.getElementById('editorOverlay');
  var editorBody = document.getElementById('editorBody');
  var editorName = document.getElementById('editorName');

  function openEditor(id){
    editingNodeId = id;
    var node = state.nodes[id];
    editorName.textContent = node.label + ' — notes';
    editorBody.innerHTML = node.text || '';
    overlay.classList.add('open');
    resetBulletState();
    setTimeout(function(){ editorBody.focus(); }, 0);
  }

  function closeEditor(doSave){
    if(doSave && editingNodeId){
      state.nodes[editingNodeId].text = editorBody.innerHTML;
      save();
      render();
    }
    overlay.classList.remove('open');
    editingNodeId = null;
  }

  document.getElementById('btnEditorDone').addEventListener('click', function(){ closeEditor(true); });
  document.getElementById('btnEditorCancel').addEventListener('click', function(){ closeEditor(false); });
  overlay.addEventListener('mousedown', function(e){ if(e.target === overlay) closeEditor(true); });

  function hexToRgb(hex){
    var v = hex.replace('#','');
    return 'rgb(' + parseInt(v.slice(0,2),16) + ', ' + parseInt(v.slice(2,4),16) + ', ' + parseInt(v.slice(4,6),16) + ')';
  }
  var HL_COLOR_RGB = hexToRgb(HL_COLOR);

  function toggleHighlight(){
    editorBody.focus();
    var sel = window.getSelection();
    if(!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    var probe = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    var alreadyHighlighted = probe && getComputedStyle(probe).backgroundColor === HL_COLOR_RGB;
    var value = alreadyHighlighted ? 'transparent' : HL_COLOR;
    // execCommand is deprecated but remains the simplest way to wrap an
    // arbitrary selection in a highlight span inside a contenteditable box.
    try{ document.execCommand('hiliteColor', false, value); }
    catch(e){ document.execCommand('backColor', false, value); }
  }

  editorBody.addEventListener('keydown', function(e){
    if(!e.ctrlKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if(k === 'b'){ e.preventDefault(); document.execCommand('bold'); }
    else if(k === 'h'){ e.preventDefault(); toggleHighlight(); }
  });

  // "- " at the start of a line becomes a bullet list, like Docs/Notion.
  // Tracked as a tiny state machine over `input` events (inputType) instead
  // of inspecting DOM structure — contenteditable line markup (div vs br)
  // varies by browser/state and isn't reliable to sniff after the fact.
  var bulletState = 'start';
  function resetBulletState(){ bulletState = 'start'; }
  editorBody.addEventListener('click', resetBulletState);
  editorBody.addEventListener('keydown', function(e){
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].indexOf(e.key) !== -1) resetBulletState();
  });
  editorBody.addEventListener('input', function(e){
    var it = e.inputType || '';
    if(it === 'insertParagraph' || it === 'insertLineBreak'){
      resetBulletState();
      return;
    }
    if(it === 'insertText' || it === 'insertCompositionText'){
      var ch = e.data;
      if(bulletState === 'start' && ch === '-'){
        bulletState = 'dash';
      }else if(bulletState === 'dash' && ch === ' '){
        bulletState = 'done';
        document.execCommand('delete');
        document.execCommand('delete');
        document.execCommand('insertUnorderedList');
      }else{
        bulletState = 'done';
      }
      return;
    }
    if(it.indexOf('delete') !== 0) bulletState = 'done';
  });

  // ---------- present-mode read-only viewer ----------
  var viewerOverlay = document.getElementById('viewerOverlay');
  var viewerBody = document.getElementById('viewerBody');
  var viewerName = document.getElementById('viewerName');

  function openViewer(id){
    var node = state.nodes[id];
    viewerName.textContent = node.label;
    viewerBody.innerHTML = node.text || '';
    viewerOverlay.classList.add('open');
  }
  function closeViewer(){ viewerOverlay.classList.remove('open'); }

  document.getElementById('btnViewerClose').addEventListener('click', closeViewer);
  viewerOverlay.addEventListener('mousedown', function(e){ if(e.target === viewerOverlay) closeViewer(); });

  // ---------- header: mode + previews + menus ----------
  function setMode(m){
    mode = m;
    localStorage.setItem(MODE_KEY, mode);
    var btnMode = document.getElementById('btnMode');
    btnMode.innerHTML = '';
    btnMode.appendChild(icon(mode==='edit' ? 'pencil' : 'presentation'));
    var span = document.createElement('span');
    span.textContent = mode==='edit' ? 'Editing' : 'Presenting';
    btnMode.appendChild(span);
    document.getElementById('menuWrap').style.display = mode==='edit' ? '' : 'none';
    render();
  }
  document.getElementById('btnMode').addEventListener('click', function(){
    setMode(mode==='edit' ? 'present' : 'edit');
  });

  function renderPreviewsButton(){
    var btn = document.getElementById('btnPreviews');
    btn.innerHTML = '';
    btn.appendChild(icon(state.previewsOn ? 'eye' : 'eye-off'));
    btn.title = state.previewsOn ? 'Hide notes previews' : 'Show notes previews';
  }
  document.getElementById('btnPreviews').addEventListener('click', function(){
    state.previewsOn = !state.previewsOn;
    save();
    renderPreviewsButton();
    render();
  });

  var menuPanel = document.getElementById('menuPanel');
  var helpPanel = document.getElementById('helpPanel');

  function closePopovers(){
    menuPanel.classList.remove('open');
    helpPanel.classList.remove('open');
  }
  document.getElementById('btnMenu').addEventListener('click', function(e){
    e.stopPropagation();
    var open = menuPanel.classList.contains('open');
    closePopovers();
    if(!open) menuPanel.classList.add('open');
  });
  document.getElementById('btnHelp').addEventListener('click', function(e){
    e.stopPropagation();
    var open = helpPanel.classList.contains('open');
    closePopovers();
    if(!open) helpPanel.classList.add('open');
  });
  document.addEventListener('click', function(e){
    if(!e.target.closest('.menuWrap')) closePopovers();
  });

  document.getElementById('btnFit').addEventListener('click', function(){ fitToView(true); });

  // Root node's label, reduced to something safe to use as a filename:
  // characters Windows/macOS reject in names (\ / : * ? " < > |) plus
  // whitespace collapse to hyphens, so "papertrail interview" exports as
  // "papertrail-interview-mindmap-cairn.json".
  function exportFileName(){
    var root = state.nodes[state.rootId];
    var title = ((root && root.label) || '')
      .toLowerCase()
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return title ? title + '-mindmap-cairn.json' : 'mindmap-cairn.json';
  }

  document.getElementById('btnExport').addEventListener('click', function(){
    closePopovers();
    var blob = new Blob([JSON.stringify({rootId:state.rootId, nodes:state.nodes}, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  document.getElementById('btnImport').addEventListener('click', function(){
    closePopovers();
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(parsed.rootId && parsed.nodes){
          if(!confirm('Importing this file will replace your current map. Continue?')) return;
          state = parsed;
          state.focusedId = null;
          if(typeof state.previewsOn !== 'boolean') state.previewsOn = true;
          ensureBranchColors();
          save();
          renderPreviewsButton();
          render();
          fitToView(false);
        }else{
          alert('That file does not look like a valid mind map export.');
        }
      }catch(err){ alert('Could not read that file: '+err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btnNewMap').addEventListener('click', function(){
    closePopovers();
    if(confirm('Start a new blank map? This clears the current one (export first if you want to keep it).')){
      state = blankState();
      ensureBranchColors();
      save();
      renderPreviewsButton();
      render();
      fitToView(false);
    }
  });

  // ---------- boot ----------
  hydrateStaticIcons();
  state = load();
  ensureBranchColors();
  setMode(mode);
  renderPreviewsButton();
  fitToView(false);
})();
