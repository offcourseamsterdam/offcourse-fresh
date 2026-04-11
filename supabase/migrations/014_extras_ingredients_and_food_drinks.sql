-- 014: Add ingredients column + migrate food & drink items from inclusion_templates
-- ============================================================================

-- Step 1: Add ingredients array column
ALTER TABLE extras ADD COLUMN IF NOT EXISTS ingredients text[] DEFAULT NULL;

-- Step 1b: Expand price_type check to allow per_person_per_hour_cents
ALTER TABLE extras DROP CONSTRAINT IF EXISTS extras_price_type_check;
ALTER TABLE extras ADD CONSTRAINT extras_price_type_check
  CHECK (price_type = ANY (ARRAY['fixed_cents', 'percentage', 'per_person_cents', 'per_person_per_hour_cents', 'informational']));

-- Step 2: Update existing "Unlimited Drinks" → "Unlimited Bar" with hourly pricing
UPDATE extras
SET
  name = 'Unlimited Bar',
  price_type = 'per_person_per_hour_cents',
  price_value = 1000,
  vat_rate = 21,
  category = 'drinks',
  description = 'As much beer, wine, prosecco & sodas as you can handle',
  ingredients = ARRAY['Beer', 'Wine (red, white, rosé)', 'Prosecco', 'Sodas'],
  sort_order = 20,
  updated_at = now()
WHERE id = '7ca8a64d-81cb-48c9-979b-feda753a583e';

-- Step 3: Insert food items
INSERT INTO extras (name, description, image_url, category, scope, applicable_categories, price_type, price_value, vat_rate, is_required, is_active, sort_order, ingredients)
VALUES
  -- Bites Box Small
  ('Bites Box Small (1-2 guests)',
   E'A cozy snack box with a mix of cheeses, from soft and creamy to a little bit sharp. Finished with prosciutto, olives, little chutney-and-honey jars, dried fruit, fresh grapes, strawberries, crackers, cornichons and small toppings.\n\nCompact, but just right for an easygoing drink and snack moment.',
   'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/cruise-inclusions/temp-food-1763566598915.jpg',
   'food', 'global', '{private}', 'fixed_cents', 1950, 9, false, true, 30, NULL),

  -- Bites Box Medium
  ('Bites Box Medium (3-4 guests)',
   'A cozy snack box with a mix of cheeses, from soft and creamy to a little bit sharp. Finished with prosciutto, olives, little chutney-and-honey jars, dried fruit, fresh grapes, strawberries, crackers, cornichons and small toppings.',
   'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/cruise-inclusions/4dcfe65b-96c8-4da9-a3d1-6bcdcf5e75f6-1763566863637.jpg',
   'food', 'global', '{private}', 'fixed_cents', 3575, 9, false, true, 31, NULL),

  -- Bites Box Large
  ('Bites Box Large (6 guests)',
   E'Our large snack box is packed for bigger crews and proper hangs.\nFilled with different cheeses, fine charcuterie, olives, chutney-and-honey jars, dried fruit and seasonal fruit, you have everything in one go.\nCrackers, cornichons and tasty extras make it perfect to share at any party',
   'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/cruise-inclusions/ad462fd5-f8cd-40b3-9823-9ec69c416eae-1763567120600.jpg',
   'food', 'global', '{private}', 'fixed_cents', 6500, 9, false, true, 32, NULL),

  -- Charcuterie Platter
  ('Charcuterie Platter',
   E'A classic selection of Italian cold cuts like spicy salami, prosciutto and Coppa di Parma.\nServed with fresh bread, butter, olives and cornichons for an easy but really good charcuterie board.\nSimple, relaxed and exactly what you want with a drink or two.',
   'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/cruise-inclusions/temp-food-1763567093495.jpg',
   'food', 'global', '{private}', 'fixed_cents', 2160, 9, false, true, 33, NULL),

  -- Cheese Platter
  ('Cheese Platter',
   E'A hearty selection of farmhouse cheeses, from young goat cheese to well-aged old cheese.\nWith reblechon and blue cheese, plus nut bread, grapes and apple syrup on the side.\nA classic cheese board to really sit down and enjoy.',
   'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/cruise-inclusions/temp-food-1763567380580.jpg',
   'food', 'global', '{private}', 'fixed_cents', 1820, 9, false, true, 34, NULL),

  -- Fruit Platter
  ('Fruit Platter (6 guests)',
   E'A fresh platter with a mix of seasonal fruit from ''Van Gelder''.\nColorful, juicy and perfect for brunch, drinks or a meeting on board',
   'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/cruise-inclusions/temp-food-1763567485737.jpg',
   'food', 'global', '{private}', 'fixed_cents', 6500, 9, false, true, 35, NULL),

  -- Brunch
  ('Brunch (per 2 people)',
   E'A full brunch on one platter, so you can stay in relax-mode.\nYou get a bagel with egg salad, a salmon sandwich, fresh pastry, fresh fruit, crackers, butter, soft cheese, jam and a small salad.\nEasy, complete and ideal for a slow start to the day.',
   'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/cruise-inclusions/3e66c0fa-c7b4-4cb9-8d98-2991f51f94eb-1763567374968.PNG',
   'food', 'global', '{private}', 'fixed_cents', 8840, 9, false, true, 36, NULL);

-- Step 4: Insert drink items
INSERT INTO extras (name, description, image_url, category, scope, applicable_categories, price_type, price_value, vat_rate, is_required, is_active, sort_order, ingredients)
VALUES
  -- Pay per drink bar (informational — shows the menu)
  ('Pay per drink bar',
   'We charge fair, regular cafe prices',
   NULL,
   'drinks', 'global', '{private}', 'informational', 0, 21, false, true, 21,
   ARRAY['Beer €3,50', 'Red, White, Rosé wine €25', 'Prosecco €27', 'Water €2.50', 'Ice Tea Green €2,50', 'Coca Cola (Zero) €2.50']),

  -- Bring Your Own Drinks (kurkgeld / corkage fee)
  ('Bring Your Own Drinks',
   'Corkage fee — bring whatever you like on board',
   NULL,
   'drinks', 'global', '{private}', 'per_person_cents', 500, 21, false, true, 22, NULL);
