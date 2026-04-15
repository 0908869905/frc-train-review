"""
YOLO Label Editor — interactive bbox annotation tool.

Usage:
    python label_editor.py <dataset_dir>
    # dataset_dir must contain images/ and labels/ subdirectories
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import customtkinter as ctk
from PIL import Image, ImageTk

# Constants
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}
CLASS_NAMES = {0: "Red", 1: "Blue"}
CLASS_COLORS = {0: "#FF3333", 1: "#3388FF"}
HANDLE_SIZE = 6


class LabelEditor(ctk.CTk):
    def __init__(self, img_dir: Path, lbl_dir: Path,
                 start: int = 0, end: int = -1):
        super().__init__()
        self.title("YOLO Label Editor")
        self.geometry("1400x800")
        ctk.set_appearance_mode("dark")

        self.img_dir = img_dir
        self.lbl_dir = lbl_dir

        # Image list (all images, not just annotated)
        all_imgs = sorted(p for p in img_dir.iterdir()
                          if p.suffix.lower() in IMAGE_EXTS)
        if end > 0:
            all_imgs = all_imgs[start:end]
        elif start > 0:
            all_imgs = all_imgs[start:]
        self.images = all_imgs
        if not self.images:
            print("[ERROR] No images found.")
            sys.exit(1)
        print(f"[INFO] Loaded {len(self.images)} images "
              f"(range {start}-{start + len(self.images)})")

        self.idx = 0
        self.labels: list[list] = []
        self.selected = -1
        self.mode = "select"
        self.zoom = 1.0
        self.pan_x = 0.0
        self.pan_y = 0.0
        self._photo: Optional[ImageTk.PhotoImage] = None
        self._pil_img: Optional[Image.Image] = None
        self._dirty = False
        self._undo_stack: list[tuple[int, list[list]]] = []

        self._drag_action = None  # "move", "resize", "draw", None
        self._drag_handle = -1    # which handle (0-7)
        self._drag_start = (0, 0) # canvas coords at press
        self._drag_orig = None    # original bbox values at press start
        self._pan_last = (0, 0)

        # Review state
        self._review_file = img_dir.parent / "review_state.json"
        self._reviewed: set[str] = set()
        self._load_review_state()

        self._build_toolbar()
        self._build_canvas()
        self._build_statusbar()

        # Jump to first unreviewed image (resume)
        first_unreviewed = self._find_first_unreviewed()
        if first_unreviewed >= 0:
            self.idx = first_unreviewed
        self._load_current()

        # ── Bindings ──
        self.bind("<Left>", lambda e: self._prev())
        self.bind("<Right>", lambda e: self._next())
        self.bind("<Delete>", lambda e: self._delete_selected())
        self.bind("<BackSpace>", lambda e: self._delete_selected())
        self.bind("<Tab>", lambda e: self._toggle_class())
        self.bind("<Escape>", lambda e: self._set_mode("select"))
        self.bind("d", lambda e: self._set_mode("draw"))
        self.bind("D", lambda e: self._set_mode("draw"))
        self.bind("f", lambda e: self._fit_view())
        self.bind("F", lambda e: self._fit_view())
        self.bind("<Control-s>", lambda e: self._save_labels())
        self.bind("<Control-z>", lambda e: self._undo())
        self.bind("<space>", lambda e: self._mark_reviewed())

        # Mouse
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.canvas.bind("<MouseWheel>", self._on_scroll)

        # Pan (middle mouse or right click)
        self.canvas.bind("<ButtonPress-2>", self._on_pan_start)
        self.canvas.bind("<B2-Motion>", self._on_pan_move)
        self.canvas.bind("<ButtonPress-3>", self._on_pan_start)
        self.canvas.bind("<B3-Motion>", self._on_pan_move)

        # Resize
        self.canvas.bind("<Configure>", lambda e: self._on_canvas_resize(e))

    def _build_toolbar(self):
        tb = ctk.CTkFrame(self, height=40)
        tb.pack(fill="x", padx=5, pady=(5, 0))

        self.btn_prev = ctk.CTkButton(tb, text="◀ Prev", width=80,
                                       command=self._prev)
        self.btn_prev.pack(side="left", padx=2)

        self.btn_next = ctk.CTkButton(tb, text="Next ▶", width=80,
                                       command=self._next)
        self.btn_next.pack(side="left", padx=2)

        self.btn_save = ctk.CTkButton(tb, text="Save", width=60,
                                       command=self._save_labels)
        self.btn_save.pack(side="left", padx=10)

        self.lbl_progress = ctk.CTkLabel(tb, text="0/0")
        self.lbl_progress.pack(side="left", padx=10)

        self.lbl_reviewed = ctk.CTkLabel(tb, text="已審核: 0/0",
                                         text_color="#AAAAAA")
        self.lbl_reviewed.pack(side="left", padx=10)

        self.lbl_mode = ctk.CTkLabel(tb, text="Mode: Select",
                                      text_color="#88FF88")
        self.lbl_mode.pack(side="right", padx=10)

    def _build_canvas(self):
        self.canvas = ctk.CTkCanvas(self, bg="#1a1a1a",
                                     highlightthickness=0)
        self.canvas.pack(fill="both", expand=True, padx=5, pady=5)

    def _build_statusbar(self):
        sb = ctk.CTkFrame(self, height=30)
        sb.pack(fill="x", padx=5, pady=(0, 5))

        self.lbl_zoom = ctk.CTkLabel(sb, text="Zoom: 100%")
        self.lbl_zoom.pack(side="left", padx=10)

        self.lbl_file = ctk.CTkLabel(sb, text="")
        self.lbl_file.pack(side="right", padx=10)

    def _load_review_state(self):
        if self._review_file.is_file():
            try:
                data = json.loads(self._review_file.read_text())
                self._reviewed = set(data.get("reviewed", []))
            except (json.JSONDecodeError, KeyError):
                self._reviewed = set()

    def _save_review_state(self):
        data = {"reviewed": sorted(self._reviewed)}
        self._review_file.write_text(json.dumps(data, ensure_ascii=False))

    def _find_first_unreviewed(self) -> int:
        for i, img in enumerate(self.images):
            if img.name not in self._reviewed:
                return i
        return -1

    def _mark_reviewed(self):
        name = self.images[self.idx].name
        self._reviewed.add(name)
        self._auto_save()
        self._save_review_state()
        # Advance to next unreviewed
        start = (self.idx + 1) % len(self.images)
        for offset in range(len(self.images)):
            i = (start + offset) % len(self.images)
            if self.images[i].name not in self._reviewed:
                self.idx = i
                self._load_current()
                return
        # All reviewed
        self.idx = (self.idx + 1) % len(self.images)
        self._load_current()

    def _load_labels(self, path: Path) -> list[list]:
        if not path.is_file():
            return []
        out = []
        for line in path.read_text().strip().splitlines():
            p = line.split()
            if len(p) == 5:
                out.append([int(p[0]),
                            float(p[1]), float(p[2]),
                            float(p[3]), float(p[4])])
        return out

    def _save_labels(self):
        path = self.lbl_dir / f"{self.images[self.idx].stem}.txt"
        with open(path, "w") as f:
            for c, cx, cy, bw, bh in self.labels:
                f.write(f"{c} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")
        self._dirty = False

    def _load_current(self):
        ip = self.images[self.idx]
        self._pil_img = Image.open(ip)
        self.labels = self._load_labels(self.lbl_dir / f"{ip.stem}.txt")
        self.selected = -1
        self._dirty = False
        self._fit_zoom()
        self._redraw()
        self._update_ui()

    def _fit_zoom(self):
        self.update_idletasks()
        cw = self.canvas.winfo_width()
        ch = self.canvas.winfo_height()
        if cw < 10 or ch < 10:
            cw, ch = 1380, 700
        iw, ih = self._pil_img.size
        self.zoom = min(cw / iw, ch / ih, 3.0)
        self.pan_x = (cw - iw * self.zoom) / 2
        self.pan_y = (ch - ih * self.zoom) / 2

    def _img_to_canvas(self, ix: float, iy: float) -> tuple[float, float]:
        return ix * self.zoom + self.pan_x, iy * self.zoom + self.pan_y

    def _canvas_to_img(self, cx: float, cy: float) -> tuple[float, float]:
        return (cx - self.pan_x) / self.zoom, (cy - self.pan_y) / self.zoom

    def _yolo_to_pixel(self, cx, cy, bw, bh):
        iw, ih = self._pil_img.size
        x1 = (cx - bw / 2) * iw
        y1 = (cy - bh / 2) * ih
        x2 = (cx + bw / 2) * iw
        y2 = (cy + bh / 2) * ih
        return x1, y1, x2, y2

    def _pixel_to_yolo(self, x1, y1, x2, y2):
        iw, ih = self._pil_img.size
        cx = (x1 + x2) / 2 / iw
        cy = (y1 + y2) / 2 / ih
        bw = abs(x2 - x1) / iw
        bh = abs(y2 - y1) / ih
        return cx, cy, bw, bh

    def _redraw(self):
        self.canvas.delete("all")
        if self._pil_img is None:
            return
        iw, ih = self._pil_img.size
        disp_w = max(1, int(iw * self.zoom))
        disp_h = max(1, int(ih * self.zoom))
        resized = self._pil_img.resize((disp_w, disp_h), Image.LANCZOS)
        self._photo = ImageTk.PhotoImage(resized)
        self.canvas.create_image(self.pan_x, self.pan_y,
                                  anchor="nw", image=self._photo,
                                  tags="image")
        for i, (cls, cx, cy, bw, bh) in enumerate(self.labels):
            self._draw_bbox(i, cls, cx, cy, bw, bh)

        # Review overlay
        if self.images[self.idx].name in self._reviewed:
            self.canvas.create_text(
                self.pan_x + disp_w - 8, self.pan_y + 8,
                anchor="ne", text="✓ 已審核",
                fill="#44FF44", font=("Microsoft JhengHei", 16, "bold"),
                tags="review_badge")

    def _draw_bbox(self, idx: int, cls: int, cx, cy, bw, bh):
        x1, y1, x2, y2 = self._yolo_to_pixel(cx, cy, bw, bh)
        cx1, cy1 = self._img_to_canvas(x1, y1)
        cx2, cy2 = self._img_to_canvas(x2, y2)
        color = CLASS_COLORS.get(cls, "#00FF00")
        is_sel = (idx == self.selected)
        width = 3 if is_sel else 2
        self.canvas.create_rectangle(
            cx1, cy1, cx2, cy2,
            outline=color, width=width,
            tags=f"bbox_{idx}")
        label = f"{idx + 1}:{CLASS_NAMES.get(cls, '?')}"
        self.canvas.create_text(
            cx1 + 3, cy1 - 2,
            anchor="sw", text=label, fill=color,
            font=("Consolas", 11, "bold"),
            tags=f"label_{idx}")
        if is_sel:
            hs = HANDLE_SIZE
            handles = [
                (cx1, cy1), ((cx1+cx2)/2, cy1), (cx2, cy1),
                (cx1, (cy1+cy2)/2),              (cx2, (cy1+cy2)/2),
                (cx1, cy2), ((cx1+cx2)/2, cy2), (cx2, cy2),
            ]
            for hx, hy in handles:
                self.canvas.create_rectangle(
                    hx - hs, hy - hs, hx + hs, hy + hs,
                    fill="white", outline=color, width=1,
                    tags="handle")

    def _update_ui(self):
        total = len(self.images)
        self.lbl_progress.configure(text=f"{self.idx + 1}/{total}")
        self.lbl_zoom.configure(text=f"Zoom: {int(self.zoom * 100)}%")
        self.lbl_file.configure(text=self.images[self.idx].name)
        nr = sum(1 for l in self.labels if l[0] == 0)
        nb = sum(1 for l in self.labels if l[0] == 1)
        mode_text = f"Mode: {'Draw' if self.mode == 'draw' else 'Select'}"
        mode_text += f"  |  Red:{nr}  Blue:{nb}"
        self.lbl_mode.configure(
            text=mode_text,
            text_color="#FF8888" if self.mode == "draw" else "#88FF88")
        reviewed_count = sum(1 for img in self.images
                            if img.name in self._reviewed)
        self.lbl_reviewed.configure(
            text=f"已審核: {reviewed_count}/{len(self.images)}")

    def _auto_save(self):
        if self._dirty:
            self._save_labels()

    def _prev(self):
        self._auto_save()
        self.idx = (self.idx - 1) % len(self.images)
        self._load_current()

    def _next(self):
        self._auto_save()
        self.idx = (self.idx + 1) % len(self.images)
        self._load_current()

    def _set_mode(self, mode: str):
        self.mode = mode
        if mode == "select":
            self.canvas.config(cursor="")
        else:
            self.canvas.config(cursor="crosshair")
        self._update_ui()

    def _fit_view(self):
        self._fit_zoom()
        self._redraw()
        self._update_ui()

    def _delete_selected(self):
        if 0 <= self.selected < len(self.labels):
            # Save undo state
            self._undo_stack.append((self.idx, [list(l) for l in self.labels]))
            self.labels.pop(self.selected)
            self.selected = -1
            self._dirty = True
            self._redraw()
            self._update_ui()

    def _undo(self):
        if self._undo_stack:
            undo_idx, undo_labels = self._undo_stack.pop()
            if undo_idx == self.idx:
                self.labels = undo_labels
                self.selected = -1
                self._dirty = True
                self._redraw()
                self._update_ui()

    def _on_canvas_resize(self, event):
        if self._pil_img is not None:
            self._fit_zoom()
            self._redraw()
            self._update_ui()

    def _toggle_class(self):
        if 0 <= self.selected < len(self.labels):
            self.labels[self.selected][0] = 1 - self.labels[self.selected][0]
            self._dirty = True
            self._redraw()
            self._update_ui()
        return "break"  # prevent Tab from changing focus

    def _hit_test_handle(self, cx, cy) -> tuple[int, int]:
        """Check if (cx, cy) hits a resize handle.
        Returns (bbox_index, handle_index) or (-1, -1).
        handle order: TL=0, TC=1, TR=2, ML=3, MR=4, BL=5, BC=6, BR=7
        """
        if self.selected < 0 or self.selected >= len(self.labels):
            return -1, -1

        cls, bcx, bcy, bw, bh = self.labels[self.selected]
        x1, y1, x2, y2 = self._yolo_to_pixel(bcx, bcy, bw, bh)
        cx1, cy1 = self._img_to_canvas(x1, y1)
        cx2, cy2 = self._img_to_canvas(x2, y2)

        handles = [
            (cx1, cy1), ((cx1+cx2)/2, cy1), (cx2, cy1),
            (cx1, (cy1+cy2)/2),              (cx2, (cy1+cy2)/2),
            (cx1, cy2), ((cx1+cx2)/2, cy2), (cx2, cy2),
        ]
        hs = HANDLE_SIZE + 3
        for i, (hx, hy) in enumerate(handles):
            if abs(cx - hx) <= hs and abs(cy - hy) <= hs:
                return self.selected, i
        return -1, -1

    def _hit_test_bbox(self, cx, cy) -> int:
        """Check if (cx, cy) hits any bbox. Returns index or -1."""
        ix, iy = self._canvas_to_img(cx, cy)

        for i in range(len(self.labels) - 1, -1, -1):
            cls, bcx, bcy, bw, bh = self.labels[i]
            x1, y1, x2, y2 = self._yolo_to_pixel(bcx, bcy, bw, bh)
            if x1 <= ix <= x2 and y1 <= iy <= y2:
                return i
        return -1

    def _on_press(self, event):
        cx, cy = event.x, event.y

        if self.mode == "draw":
            self._drag_action = "draw"
            self._drag_start = (cx, cy)
            return

        # Check handle first (resize)
        bi, hi = self._hit_test_handle(cx, cy)
        if bi >= 0:
            self._drag_action = "resize"
            self._drag_handle = hi
            self._drag_start = (cx, cy)
            self._drag_orig = list(self.labels[bi])
            return

        # Check bbox (select + move)
        bi = self._hit_test_bbox(cx, cy)
        if bi >= 0:
            self.selected = bi
            self._drag_action = "move"
            self._drag_start = (cx, cy)
            self._drag_orig = list(self.labels[bi])
            self._redraw()
            self._update_ui()
            return

        # Click on empty = deselect
        self.selected = -1
        self._drag_action = None
        self._redraw()
        self._update_ui()

    def _on_drag(self, event):
        cx, cy = event.x, event.y

        if self._drag_action == "move" and self.selected >= 0:
            dx = (cx - self._drag_start[0]) / self.zoom
            dy = (cy - self._drag_start[1]) / self.zoom
            iw, ih = self._pil_img.size
            orig = self._drag_orig
            bw, bh = orig[3], orig[4]
            new_cx = orig[1] + dx / iw
            new_cy = orig[2] + dy / ih
            self.labels[self.selected][1] = max(bw / 2, min(1 - bw / 2, new_cx))
            self.labels[self.selected][2] = max(bh / 2, min(1 - bh / 2, new_cy))
            self._dirty = True
            self._redraw()

        elif self._drag_action == "resize" and self.selected >= 0:
            self._do_resize(cx, cy)

        elif self._drag_action == "draw":
            self._redraw()
            self.canvas.create_rectangle(
                self._drag_start[0], self._drag_start[1], cx, cy,
                outline="#FFFF00", width=2, dash=(4, 4),
                tags="draw_preview")

    def _on_release(self, event):
        cx, cy = event.x, event.y

        if self._drag_action == "draw":
            sx, sy = self._drag_start
            if abs(cx - sx) > 5 and abs(cy - sy) > 5:
                ix1, iy1 = self._canvas_to_img(min(sx, cx), min(sy, cy))
                ix2, iy2 = self._canvas_to_img(max(sx, cx), max(sy, cy))
                iw, ih = self._pil_img.size
                ix1 = max(0, min(ix1, iw))
                iy1 = max(0, min(iy1, ih))
                ix2 = max(0, min(ix2, iw))
                iy2 = max(0, min(iy2, ih))
                ncx, ncy, nbw, nbh = self._pixel_to_yolo(ix1, iy1, ix2, iy2)
                if nbw > 0.005 and nbh > 0.005:
                    self.labels.append([0, ncx, ncy, nbw, nbh])
                    self.selected = len(self.labels) - 1
                    self._dirty = True

            self._set_mode("select")
            self._redraw()
            self._update_ui()

        self._drag_action = None

    def _do_resize(self, cx, cy):
        """Resize selected bbox based on which handle is dragged."""
        orig = self._drag_orig
        x1, y1, x2, y2 = self._yolo_to_pixel(orig[1], orig[2], orig[3], orig[4])

        ix, iy = self._canvas_to_img(cx, cy)
        iw, ih = self._pil_img.size
        ix = max(0, min(ix, iw))
        iy = max(0, min(iy, ih))

        h = self._drag_handle
        if h in (0, 3, 5): x1 = ix
        if h in (2, 4, 7): x2 = ix
        if h in (0, 1, 2): y1 = iy
        if h in (5, 6, 7): y2 = iy

        if abs(x2 - x1) > 5 and abs(y2 - y1) > 5:
            nx1, ny1, nx2, ny2 = min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)
            ncx, ncy, nbw, nbh = self._pixel_to_yolo(nx1, ny1, nx2, ny2)
            self.labels[self.selected] = [orig[0], ncx, ncy, nbw, nbh]
            self._dirty = True
            self._redraw()

    def _on_scroll(self, event):
        """Mouse wheel zoom, centered on cursor position."""
        ix, iy = self._canvas_to_img(event.x, event.y)

        if event.delta > 0:
            factor = 1.15
        else:
            factor = 1 / 1.15

        new_zoom = self.zoom * factor
        new_zoom = max(0.1, min(new_zoom, 10.0))
        self.zoom = new_zoom

        self.pan_x = event.x - ix * self.zoom
        self.pan_y = event.y - iy * self.zoom

        self._redraw()
        self._update_ui()

    def _on_pan_start(self, event):
        self._pan_last = (event.x, event.y)

    def _on_pan_move(self, event):
        dx = event.x - self._pan_last[0]
        dy = event.y - self._pan_last[1]
        self.pan_x += dx
        self.pan_y += dy
        self._pan_last = (event.x, event.y)
        self._redraw()


def main():
    parser = argparse.ArgumentParser(description="YOLO Label Editor")
    parser.add_argument("dataset", type=Path,
                        help="Dataset directory (must contain images/)")
    parser.add_argument("--images", type=str, default="images",
                        help="Images subdirectory name (default: images)")
    parser.add_argument("--labels", type=str, default="labels_raw",
                        help="Labels subdirectory name (default: labels_raw)")
    parser.add_argument("--start", type=int, default=0,
                        help="Start index (default: 0)")
    parser.add_argument("--end", type=int, default=-1,
                        help="End index exclusive (default: all)")
    args = parser.parse_args()

    img_dir = args.dataset / args.images
    lbl_dir = args.dataset / args.labels

    if not img_dir.is_dir():
        print(f"[ERROR] images/ not found in {args.dataset}")
        sys.exit(1)
    if not lbl_dir.is_dir():
        lbl_dir.mkdir(parents=True)
        print(f"[INFO] Created {args.labels}/ directory")

    app = LabelEditor(img_dir, lbl_dir, args.start, args.end)
    app.mainloop()


if __name__ == "__main__":
    main()
