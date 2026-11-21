# Шрифт Echo Serif

Свой шрифт сайта для заголовков, названий дней и обложек. Прямое и курсивное начертание, кириллица (включая казахские буквы), латиница, цифры, «» — № ₸.

Как сделан: основа — Lora (SIL OFL 1.1), вес 600. Каждая буква «пропущена через пресс» скриптом `make_font.py`: контур чуть растекается (+7 ед.), краска затекает во внутренние углы (скругление 24), внешние углы смягчаются (16), край получает едва заметную неровность (шум 3 ед.), хинтинг снят, имя заменено на Echo Serif (у Lora зарезервировано имя, поэтому переименование обязательно).

```
python3 make_font.py --family "Echo Serif" "Lora[wght].ttf" EchoSerif-Regular.ttf --axes wght=600 --spread 7 --close 24 --open 16 --amp 3 --lam 75 --track 6
python3 make_font.py --family "Echo Serif" "Lora-Italic[wght].ttf" EchoSerif-Italic.ttf --axes wght=600 --spread 7 --close 24 --open 16 --amp 3 --lam 75 --track 6 --style Italic
```

Файлы: `public/fonts/echo-serif-regular.woff2`, `public/fonts/echo-serif-italic.woff2`, лицензия `public/fonts/OFL.txt`.
