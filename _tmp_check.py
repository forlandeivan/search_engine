import itertools
with open('server/routes.ts', encoding='utf-8-sig') as f:
    for i, line in zip(range(1, 600), f):
        if i in (430, 440, 450, 460, 470, 480, 490, 500, 510, 520):
            print(i, line.rstrip())
