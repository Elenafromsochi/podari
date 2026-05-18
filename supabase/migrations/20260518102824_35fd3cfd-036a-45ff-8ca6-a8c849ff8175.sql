-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Гость',
  balance INTEGER NOT NULL DEFAULT 100,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Gifts
CREATE TABLE public.gifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'разное',
  cost INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'available',
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gifts_select_all" ON public.gifts FOR SELECT USING (true);
CREATE POLICY "gifts_insert_owner" ON public.gifts FOR INSERT WITH CHECK (auth.uid() = owner_id OR owner_id IS NULL);
CREATE POLICY "gifts_update_owner" ON public.gifts FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "gifts_delete_owner" ON public.gifts FOR DELETE USING (auth.uid() = owner_id);

-- Transactions
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gift_id UUID REFERENCES public.gifts(id) ON DELETE CASCADE,
  sender_id UUID,
  receiver_id UUID,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tx_select_party" ON public.transactions FOR SELECT USING (auth.uid() IN (sender_id, receiver_id));

-- Chats
CREATE TABLE public.chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gift_id UUID REFERENCES public.gifts(id) ON DELETE CASCADE,
  user_a UUID,
  user_b UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chats_select_party" ON public.chats FOR SELECT USING (auth.uid() IN (user_a, user_b));
CREATE POLICY "chats_insert_party" ON public.chats FOR INSERT WITH CHECK (auth.uid() IN (user_a, user_b));

-- Messages
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id UUID,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_select_party" ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND auth.uid() IN (c.user_a, c.user_b))
);
CREATE POLICY "messages_insert_party" ON public.messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND auth.uid() IN (c.user_a, c.user_b))
);

-- Reviews
CREATE TABLE public.reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  author_id UUID,
  target_id UUID,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_select_all" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_author" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = author_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER gifts_touch BEFORE UPDATE ON public.gifts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed 5 demo gifts
INSERT INTO public.gifts (title, description, category, cost) VALUES
  ('Книга «Маленький принц»', 'Зачитанная, но любимая. Передам в добрые руки за чашку кофе ✨', 'книги', 40),
  ('Сеанс медитации онлайн', '20 минут вместе в Zoom. Успокоим ум перед сном 🧘', 'медитации', 60),
  ('Кофе с собой ☕', 'Сварю фильтр-кофе у себя дома, заходи в гости в центре города', 'кофе', 30),
  ('Старая гитара', 'Акустика, требует настройки. Для того, кто учится играть 🎸', 'хобби', 80),
  ('Домашние пирожки', 'Испеку партию с капустой или яблоком. Заберёшь горячими 🥟', 'еда', 50);