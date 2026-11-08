"""Part C charts from the live database query results (29 Oct 2026)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
import os, sys

OUT = sys.argv[1]
for f in ["Inter-Regular.otf", "Inter-SemiBold.otf"]:
    fm.fontManager.addfont(f"/usr/share/fonts/opentype/inter/{f}")
plt.rcParams.update({"font.family": "Inter", "font.size": 11, "axes.edgecolor": "#4A5751", "axes.labelcolor": "#17221D",
                     "xtick.color": "#4A5751", "ytick.color": "#4A5751", "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": "#E3E7E1", "grid.linewidth": 1, "axes.axisbelow": True, "figure.dpi": 200})
C1, C2 = "#16875F", "#C27F00"
SRC = "Source: Corner Café Supabase database, 147 orders, 7–27 Oct 2026 (generated test data, is_test_data = true)."

def finish(fig, ax, title, name, note=SRC):
    ax.set_title(title, loc="left", fontsize=14, fontweight="semibold", pad=12)
    fig.text(0.01, 0.01, note, fontsize=8.5, color="#4A5751")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(os.path.join(OUT, name)); plt.close(fig)

# Q1 orders by hour
hours = list(range(8, 20)); orders = [20, 18, 11, 16, 16, 20, 7, 9, 10, 11, 8, 1]
fig, ax = plt.subplots(figsize=(8, 4.2))
bars = ax.bar([f"{h}:00" for h in hours], orders, color=C1, width=0.65)
for b, v in zip(bars, orders):
    if v == max(orders): ax.text(b.get_x() + b.get_width() / 2, v + 0.4, str(v), ha="center", fontsize=10, fontweight="semibold")
ax.set_xlabel("Hour of the day (Astana time, UTC+5)"); ax.set_ylabel("Number of orders")
ax.grid(axis="x", visible=False)
from matplotlib.ticker import MaxNLocator
ax.yaxis.set_major_locator(MaxNLocator(integer=True))
finish(fig, ax, "Chart C1. Orders by hour of the day", "c1_orders_by_hour.png")

# Q2 top items
items = ["Mint Tea", "Black Tea", "Iced Americano", "Iced Mocha", "Vanilla Latte", "Cappuccino", "Americano", "Cold Brew", "Cheesecake", "Latte"]
portions = [24, 19, 17, 16, 15, 15, 15, 14, 14, 14]
fig, ax = plt.subplots(figsize=(8, 4.6))
ax.barh(items[::-1], portions[::-1], color=C1, height=0.6)
for i, v in enumerate(portions[::-1]): ax.text(v + 0.3, i, str(v), va="center", fontsize=10)
ax.set_xlabel("Portions sold (sum of quantity)"); ax.set_ylabel("Menu item")
ax.grid(axis="y", visible=False)
finish(fig, ax, "Chart C2. The ten most ordered menu items", "c2_top_items.png")

# Q3 time to ready by hour (stacked: waiting + preparing)
wait = [4.0, 4.1, 4.1, 3.9, 4.2, 3.7, 3.6, 4.2, 3.5, 4.1, 3.8, 2.5]
prep = [14.8, 11.9, 12.0, 11.9, 14.5, 14.2, 12.5, 12.3, 12.1, 12.5, 12.4, 12.8]
fig, ax = plt.subplots(figsize=(8, 4.4))
x = [f"{h}:00" for h in hours]
ax.bar(x, wait, color=C1, width=0.65, label="Waiting to start (Received → Preparing)", edgecolor="white", linewidth=1)
ax.bar(x, prep, bottom=wait, color=C2, width=0.65, label="Preparing (Preparing → Ready)", edgecolor="white", linewidth=1)
for i, (w, p) in enumerate(zip(wait, prep)):
    if i in (0, 4, 5): ax.text(i, w + p + 0.3, f"{w + p:.1f}", ha="center", fontsize=9.5, fontweight="semibold")
ax.axhline(17.0, color="#17221D", linewidth=1, linestyle=(0, (4, 3)))
ax.text(11.4, 17.3, "average 17.0 min", ha="right", fontsize=9)
ax.set_xlabel("Hour the order was placed (Astana time)"); ax.set_ylabel("Average minutes from order to ready")
ax.set_ylim(0, 22); ax.grid(axis="x", visible=False)
ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=2, frameon=False, fontsize=9.5)
finish(fig, ax, "Chart C3. Time from order to ready, by hour", "c3_time_to_ready.png")

# extra: orders per day (change over time)
days = [f"{d}" for d in range(7, 28)]
per_day = [8, 6, 6, 4, 4, 8, 9, 9, 6, 7, 6, 6, 9, 7, 9, 8, 8, 6, 6, 7, 8]
fig, ax = plt.subplots(figsize=(8, 3.6))
ax.plot(days, per_day, color=C1, linewidth=2, marker="o", markersize=5)
ax.set_xlabel("Day of October 2026"); ax.set_ylabel("Orders per day"); ax.set_ylim(0, 10)
finish(fig, ax, "Chart C4. Orders per day", "c4_orders_per_day.png")
print("ok")
