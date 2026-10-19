import json
import math
import os
import sys

# writes a bake from the browser (spike.bake's steps, saved by the playwright mcp's browser_evaluate) as a keys file
# in the same compact form as the others, keeping only each step's fold, frame, and pose. it prints the largest move
# between neighboring steps per side, so a bake that jumps shows before it's used, and how much it shakes, since the
# playback curve runs through every key and keeps a back and forth that no single step shows
# usage: python3 tools/saveKeys.py <BAKE_JSON> <OUT_JSON> [bake]

JOINTS = ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "t1x", "t1z", "t2", "t3"]


def largestStep(steps):
    move = 0.0
    turn = 0.0
    for a, b in zip(steps, steps[1:]):
        pa = a["pose"]
        pb = b["pose"]
        move = max(move, math.dist([pa["px"], pa["py"], pa["pz"]], [pb["px"], pb["py"], pb["pz"]]))
        turn = max(turn, max(abs(pa.get(n, 0) - pb.get(n, 0)) for n in JOINTS))
    return move, turn


# how much a hand's keys shake: wrist steps over 0.15 cm that turn back (cosine under -0.3), the largest second
# difference of the wrist path in cm, and joints that swing more than 2 degrees one way and then back
def shake(steps):
    points = [[s["pose"]["px"], s["pose"]["py"], s["pose"]["pz"]] for s in steps]
    moves = [[b[k] - a[k] for k in range(3)] for a, b in zip(points, points[1:])]
    reversals = 0
    for a, b in zip(moves, moves[1:]):
        la = math.hypot(*a)
        lb = math.hypot(*b)
        if (la > 0.15 and lb > 0.15 and sum(x * y for x, y in zip(a, b)) / (la * lb) < -0.3):
            reversals += 1
    bend = 0.0
    for a, b in zip(moves, moves[1:]):
        bend = max(bend, math.hypot(*[y - x for x, y in zip(a, b)]))
    swings = 0
    for n in JOINTS:
        values = [s["pose"].get(n, 0) for s in steps]
        turns = [b - a for a, b in zip(values, values[1:])]
        for a, b in zip(turns, turns[1:]):
            if ((a > 2 and b < -2) or (a < -2 and b > 2)):
                swings += 1
    return reversals, bend, swings


FRAMES = ("device", "body", "flap")


# what would stop the keys playing back: a step with no pose or an unknown frame, or folds that don't run from 1
# down to 0. a bake also has the same number of steps on both sides, which authored keys don't
def problems(out, bake):
    found = []
    for side, steps in out.items():
        for i, step in enumerate(steps):
            if not isinstance(step.get("pose"), dict):
                found.append(f"{side} step {i} has no pose")
            if step.get("frame") not in FRAMES:
                found.append(f"{side} step {i} has frame {step.get('frame')!r}")
        folds = [step.get("fold") for step in steps]
        numbers = all(isinstance(f, (int, float)) for f in folds)
        ends = numbers and len(folds) >= 2 and folds[0] == 1 and folds[-1] == 0
        if not ends or any(b >= a for a, b in zip(folds, folds[1:])):
            found.append(f"{side} folds don't run from 1 down to 0")
    counts = {side: len(steps) for side, steps in out.items()}
    if bake and len(set(counts.values())) > 1:
        found.append(f"the sides have different step counts: {counts}")
    return found


def roundFolds(out):
    for steps in out.values():
        for step in steps:
            step["fold"] = round(step["fold"], 6)
    return out


# the file is written beside its place and moved over it, so a write that fails leaves the old keys as they were
def writeKeys(out, path):
    temp = path + ".tmp"
    try:
        with open(temp, "w") as file:
            json.dump(out, file, separators=(",", ":"))
        os.replace(temp, path)
    except BaseException:
        if os.path.exists(temp):
            os.remove(temp)
        raise


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4) or (len(sys.argv) == 4 and sys.argv[3] != "bake"):
        print("usage: python3 tools/saveKeys.py <BAKE_JSON> <OUT_JSON> [bake]")
        sys.exit(1)
    isBake = len(sys.argv) == 4
    bake = json.load(open(sys.argv[1]))
    out = {}
    for side in ("Left", "Right"):
        if side not in bake:
            print("the bake has no", side)
            sys.exit(1)
        out[side] = [{"fold": s.get("fold"), "frame": s.get("frame"), "pose": s.get("pose")} for s in bake[side]]
    found = problems(out, isBake)
    if found:
        for line in found:
            print(line)
        print("nothing written")
        sys.exit(1)
    roundFolds(out)
    for side in ("Left", "Right"):
        move, turn = largestStep(out[side])
        reversals, bend, swings = shake(out[side])
        print(f"{side}: {len(out[side])} keys, largest step {move:.3f} cm and {turn:.1f} degrees")
        print(f"{side}: shake {reversals} turns back, largest bend {bend:.3f} cm, {swings} joint swings")
    writeKeys(out, sys.argv[2])
    print("wrote", sys.argv[2])
