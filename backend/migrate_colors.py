import sqlite3

COLOR_CODES = {
    "Мультиколор": ("STD", 1),
    "Черный": ("BLK", 1),
    "Белый": ("WHT", 1),
    "Темно-синий": ("NVY", 1),
    "Синий": ("BLU", 1),
    "Серый": ("GRY", 1),
    "Бежевый": ("BEI", 1),
    "Коричневый": ("BRN", 1),
    "Красный": ("RED", 1),
    "Зеленый": ("GRN", 1),
    "Хаки": ("KHK", 1),
    "Молочный": ("MLK", 0),
    "Бордовый": ("BOR", 0),
    "Голубой": ("LBL", 0),
    "Желтый": ("YEL", 0),
    "Оранжевый": ("ORN", 0),
    "Розовый": ("PNK", 0),
    "Фиолетовый": ("VIO", 0),
    "Золотистый": ("GLD", 0),
    "Кофейный": ("COF", 0),
    "Цитрон": ("CTR", 0),
    "Бледно-серый": ("LGY", 0),
    "Лимон лайм": ("LIM", 0),
    "Желто-зеленый": ("YGR", 0),
    "Салатовый": ("LGR", 0),
    "Бутылочно-зеленый": ("BGR", 0),
    "Болотный": ("MAR", 0),
    "Оливковый": ("OLV", 0),
    "Темно-зеленый": ("DGR", 0),
    "Ментоловый": ("MNT", 0),
    "Каштан": ("CSH", 0),
    "Бледно-коричневый": ("LBR", 0),
    "Вишневый": ("CHR", 0),
    "Рубин": ("RBY", 0),
    "Бринк розовый": ("BPK", 0),
    "Кораллово-розовый": ("CPK", 0),
    "Грязно-розовый": ("DPK", 0),
    "Темно-розовый": ("DPN", 0),
    "Серо-розовый": ("GPK", 0),
    "Фуксия": ("FUX", 0),
    "Лиловый": ("LIL", 0),
    "Пурпурный": ("PRP", 0),
    "Бирюзовый": ("TRQ", 0),
    "Бирюзово-зеленый": ("TQG", 0),
    "Мята": ("MYA", 0),
    "Кадетский серый": ("CDG", 0),
    "Холодный серый": ("CLG", 0),
    "Черный оливковый": ("BOL", 0),
    "Темно-серый": ("DGY", 0),
    "Джинсовый": ("DNM", 0),
    "Электрический индиго": ("IND", 0),
    "Небесно-синий": ("SKY", 0),
    "Уголь": ("COL", 0),
    "Темно-коричневый": ("DBR", 0),
    "Рыжий": ("RZH", 0),
}

def migrate():
    conn = sqlite3.connect('kirim.db')
    cursor = conn.cursor()
    
    # 1. Add columns if not exist
    table_info = [col[1] for col in cursor.execute("PRAGMA table_info(ranglar)").fetchall()]
    if "short_code" not in table_info:
        cursor.execute("ALTER TABLE ranglar ADD COLUMN short_code VARCHAR(10)")
        print("Added column short_code")
    if "is_favorite" not in table_info:
        cursor.execute("ALTER TABLE ranglar ADD COLUMN is_favorite BOOLEAN DEFAULT 0")
        print("Added column is_favorite")

    # 2. Populate codes
    rows = cursor.execute("SELECT id, name FROM ranglar").fetchall()
    used_codes = set()
    for row_id, name in rows:
        mapping = COLOR_CODES.get(name)
        if mapping:
            code, fav = mapping
        else:
            # Fallback code
            code = name[:3].upper() if len(name) >= 3 else (name + "XX")[:3].upper()
            fav = 0
            
        counter = 1
        base_code = code
        while code in used_codes:
            code = f"{base_code[:2]}{counter}"
            counter += 1
        used_codes.add(code)
        
        cursor.execute("UPDATE ranglar SET short_code = ?, is_favorite = ? WHERE id = ?", (code, fav, row_id))
        
    conn.commit()
    print(f"Updated {len(rows)} colors with unique short codes.")
    conn.close()

if __name__ == "__main__":
    migrate()
