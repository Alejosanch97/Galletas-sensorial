import { useState, useCallback, useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  PartyPopper,
  Loader2,
  CheckCircle2,
  CloudOff,
  CloudUpload,
} from "lucide-react";
import "../styles/encuesta-cata.css";

/* /exec de TU deployment (Sheet + Codigo.gs) */
const API_URL = "https://script.google.com/macros/s/AKfycbxKv8CGUF6Ki5tDzHQwu_65LyacEdgR-z9vSVDFLrdyfSoh8G3jilniFVrfwEnJOSdzKA/exec";
const SHEET = "Respuestas";
const QUEUE_KEY = "cata_galletas_cola_v1";

/* Códigos de 3 dígitos que van en los platos.
   Deben ser iguales a los de la hoja "Codigos".
   El niño solo ve el número: el tratamiento lo completa el Apps Script. */
const CODIGOS = ["482", "917", "235", "671", "358", "764", "129", "593", "846"];
const MAX_MUESTRAS = 4; // galletas por niño (más de 4 satura el paladar)

/* ---------- ESCALAS ---------- */
const ETIQ_GUSTO = [
  "No me gustó 😖",
  "Poquito 😕",
  "Normal 🙂",
  "Me gustó 😋",
  "¡Me encantó! 🤩",
];

const JAR_DULCE = [
  { valor: "Poco",  emoji: "🤏", label: "Le falta dulce", tono: "bajo" },
  { valor: "Justo", emoji: "👌", label: "¡Perfecta!",     tono: "justo" },
  { valor: "Mucho", emoji: "🥴", label: "Muy dulce",      tono: "alto" },
];

const JAR_NUTELLA = [
  { valor: "Poco",  emoji: "🥄", label: "Poquita",    tono: "bajo" },
  { valor: "Justo", emoji: "👌", label: "¡Perfecta!", tono: "justo" },
  { valor: "Mucho", emoji: "🌋", label: "Demasiada",  tono: "alto" },
];

const COMPRA = [
  { valor: "Sí",      emoji: "💚", label: "¡Sí!",    tono: "si" },
  { valor: "Tal vez", emoji: "🤔", label: "Tal vez", tono: "talvez" },
  { valor: "No",      emoji: "🙅", label: "No",      tono: "no" },
];

/* ---------- PASOS POR GALLETA (orden sensorial: ver → oler → probar → morder → total) ---------- */
const PASOS_GALLETA = [
  {
    emoji: "👀", titulo: "¡Mírala bien!", ayuda: "Todavía no la muerdas 😉",
    preguntas: [
      { campo: "apariencia", tipo: "galletas", texto: "¿Qué tanto te gusta cómo se ve?" },
    ],
  },
  {
    emoji: "👃", titulo: "¡Ahora huélela!", ayuda: "Acércala a tu nariz y respira",
    preguntas: [
      { campo: "aroma", tipo: "galletas", texto: "¿Qué tanto te gusta cómo huele?" },
    ],
  },
  {
    emoji: "😋", titulo: "¡A probar!", ayuda: "Dale un buen mordisco",
    preguntas: [
      { campo: "sabor",     tipo: "galletas", texto: "¿Qué tanto te gustó el sabor?" },
      { campo: "dulzor",    tipo: "galletas", texto: "¿Qué tan rico te pareció lo dulce?" },
      { campo: "dulzorJar", tipo: "opciones", texto: "De dulce, la galleta está...", opciones: JAR_DULCE },
    ],
  },
  {
    emoji: "🍫", titulo: "¡El relleno de Nutella!", ayuda: "Busca el corazón de chocolate",
    preguntas: [
      { campo: "nutellaSabor", tipo: "galletas", texto: "¿Qué tanto te gustó la Nutella?" },
      { campo: "nutellaJar",   tipo: "opciones", texto: "La cantidad de Nutella es...", opciones: JAR_NUTELLA },
    ],
  },
  {
    emoji: "🦷", titulo: "¿Cómo se siente al morderla?", ayuda: "Fíjate en el centro y en el borde",
    preguntas: [
      { campo: "textura", tipo: "galletas", texto: "¿Qué tanto te gustó la textura?" },
      { campo: "centro",  tipo: "galletas", texto: "¿Qué tanto te gustó el centro blandito? ☁️" },
      { campo: "borde",   tipo: "galletas", texto: "¿Qué tanto te gustó el borde crujiente? 🥨" },
    ],
  },
  {
    emoji: "❤️", titulo: "Y en total...", ayuda: "¡La pregunta más importante!",
    preguntas: [
      { campo: "gusto",     tipo: "galletas", texto: "¿Qué tanto te gustó ESTA galleta?", grande: true },
      { campo: "compraria", tipo: "opciones", texto: "¿La comprarías?", opciones: COMPRA },
    ],
  },
];

const MEJORAS = [
  "🍫 Más Nutella", "🍪 Más grande", "🍬 Menos dulce", "🍭 Más dulce",
  "☁️ Más suavecita", "🥨 Más crujiente", "🔥 Más doradita", "🌟 Más chispas",
  "✨ ¡Así está perfecta!",
];

const GRADOS = ["6°", "7°", "8°", "9°", "10°", "11°"];
const EDADES = [10, 11, 12, 13, 14, 15, 16, 17, 18];
const GENEROS = [
  { valor: "Niña", emoji: "👧" },
  { valor: "Niño", emoji: "👦" },
  { valor: "Prefiero no decir", emoji: "🙂" },
];

/* ---------- ESTADOS VACÍOS ---------- */
const PERFIL_VACIO = { nombre: "", edad: "", grado: "", genero: "" };
const GALLETA_VACIA = {
  codigo: "", apariencia: 0, aroma: 0, sabor: 0, dulzor: 0, dulzorJar: "",
  nutellaSabor: 0, nutellaJar: "", textura: 0, centro: 0, borde: 0,
  gusto: 0, compraria: "",
};
const FINAL_VACIO = { favorita: "", mejoras: [], comentario: "" };

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/* ---------- COLA LOCAL (localStorage) ---------- */
const leerCola = () => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
  catch { return []; }
};
const guardarCola = (q) => {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
};

/* ---------- COMPONENTES ---------- */
const RatingGalletas = ({ valor, onChange, grande }) => (
  <div className={`cata-rating ${grande ? "cata-rating--grande" : ""}`}>
    <div className="cata-cookies">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={valor === n ? `pop-${n}` : n}
          type="button"
          className={`cata-cookie ${valor >= n ? "on" : ""} ${valor === n ? "pop" : ""}`}
          onClick={() => onChange(n)}
          aria-label={`${n} de 5 galletas`}
        >
          🍪
        </button>
      ))}
    </div>
    <p className={`cata-rating-txt ${valor ? "show" : ""}`}>
      {valor ? ETIQ_GUSTO[valor - 1] : "Toca las galletas 👆"}
    </p>
  </div>
);

const Opciones = ({ valor, onChange, opciones }) => (
  <div className="cata-jar">
    {opciones.map((o) => (
      <button
        key={o.valor}
        type="button"
        className={`cata-jar-btn cata-jar-btn--${o.tono} ${valor === o.valor ? "sel" : ""}`}
        onClick={() => onChange(o.valor)}
      >
        <span className="cata-jar-emoji">{o.emoji}</span>
        <span>{o.label}</span>
      </button>
    ))}
  </div>
);

/* =================================================================== */
export const Home = () => {
  const [pantalla, setPantalla] = useState("intro"); // intro | perfil | instrucciones | codigo | galleta | agua | final | gracias
  const [paso, setPaso] = useState(0);
  const [perfil, setPerfil] = useState(PERFIL_VACIO);
  const [galleta, setGalleta] = useState(GALLETA_VACIA);
  const [probadas, setProbadas] = useState([]);
  const [final, setFinal] = useState(FINAL_VACIO);
  const catadorRef = useRef(uid());

  /* ---- Estado de sincronización ---- */
  const [sync, setSync] = useState(() => (leerCola().length ? "pendiente" : "ok")); // ok | syncing | pendiente | error
  const [pendientes, setPendientes] = useState(() => leerCola().length);
  const enviandoRef = useRef(false);
  const reintentoRef = useRef(null);

  const sincronizar = useCallback(async () => {
    if (enviandoRef.current) return;
    clearTimeout(reintentoRef.current);

    const cola = leerCola();
    setPendientes(cola.length);
    if (cola.length === 0) { setSync("ok"); return; }

    enviandoRef.current = true;
    setSync("syncing");

    try {
      // Todo el lote en un solo POST (Apps Script es lento: menos llamadas = más rápido)
      const res = await fetch(API_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "registrar_lote", sheet: SHEET, filas: cola }),
      });
      const json = JSON.parse(await res.text());
      if (json.status !== "success") throw new Error(json.message);

      // Quita solo lo que se envió (pudieron entrar respuestas nuevas mientras tanto)
      const enviados = new Set(cola.map((f) => f.id_respuesta));
      const restantes = leerCola().filter((f) => !enviados.has(f.id_respuesta));
      guardarCola(restantes);
      setPendientes(restantes.length);
      enviandoRef.current = false;

      if (restantes.length) sincronizar();
      else setSync("ok"); // 🟢 ya está en el Excel
    } catch (e) {
      console.error("Fallo al sincronizar, se reintentará:", e);
      enviandoRef.current = false;
      setPendientes(leerCola().length);
      setSync("error");
      reintentoRef.current = setTimeout(() => sincronizar(), 8000);
    }
  }, []);

  /* Al abrir: sube lo pendiente. Si vuelve el internet: reintenta. */
  useEffect(() => {
    sincronizar();
    const alVolver = () => sincronizar();
    window.addEventListener("online", alVolver);
    return () => {
      window.removeEventListener("online", alVolver);
      clearTimeout(reintentoRef.current);
    };
  }, [sincronizar]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [pantalla, paso]);

  /* ---- Helpers de estado ---- */
  const setP = (campo, valor) => setPerfil((p) => ({ ...p, [campo]: valor }));
  const setG = (campo, valor) => setGalleta((g) => ({ ...g, [campo]: valor }));
  const toggleMejora = (m) =>
    setFinal((f) => ({
      ...f,
      mejoras: f.mejoras.includes(m) ? f.mejoras.filter((x) => x !== m) : [...f.mejoras, m],
    }));

  const pasoActual = PASOS_GALLETA[paso];
  const codigosRestantes = CODIGOS.filter((c) => !probadas.some((p) => p.codigo === c));
  const puedeOtra = probadas.length < MAX_MUESTRAS && codigosRestantes.length > 0;

  /* ---- Validación ---- */
  const puedeSeguir = (() => {
    switch (pantalla) {
      case "perfil":  return !!(perfil.edad && perfil.grado && perfil.genero);
      case "codigo":  return !!galleta.codigo;
      case "galleta": return pasoActual.preguntas.every((p) => !!galleta[p.campo]);
      case "final":   return probadas.length < 2 || !!final.favorita;
      default:        return true;
    }
  })();

  /* ---- ENVIAR: optimistic UI ---- */
  const enviar = () => {
    const favorita = probadas.length === 1 ? probadas[0].codigo : final.favorita;

    // 1 fila por galleta probada
    const filas = probadas.map((g, i) => ({
      id_respuesta: uid(),
      id_catador: catadorRef.current,
      Nombre: perfil.nombre.trim() || "Anónimo",
      Edad: perfil.edad,
      Grado: perfil.grado,
      Genero: perfil.genero,
      Orden: i + 1,
      Codigo: g.codigo,
      Apariencia: g.apariencia,
      Aroma: g.aroma,
      Sabor: g.sabor,
      Dulzor: g.dulzor,
      Dulzor_JAR: g.dulzorJar,
      Nutella_Sabor: g.nutellaSabor,
      Nutella_JAR: g.nutellaJar,
      Textura: g.textura,
      Centro_Suave: g.centro,
      Borde_Crujiente: g.borde,
      Gusto_General: g.gusto,
      Compraria: g.compraria,
      Es_Favorita: g.codigo === favorita ? "Sí" : "No",
      Mejoras: final.mejoras.join(", "),
      Comentario: final.comentario.trim(),
    }));

    // 1) Se guarda YA en el dispositivo (nada se pierde)
    const cola = [...leerCola(), ...filas];
    guardarCola(cola);
    setPendientes(cola.length);
    setSync("pendiente");

    // 2) Gracias al instante
    setPantalla("gracias");

    // 3) Sube al Excel en segundo plano
    sincronizar();
  };

  const reiniciar = () => {
    setPerfil(PERFIL_VACIO);
    setGalleta(GALLETA_VACIA);
    setProbadas([]);
    setFinal(FINAL_VACIO);
    setPaso(0);
    catadorRef.current = uid();
    setPantalla("intro");
  };

  /* ---- Navegación ---- */
  const siguiente = () => {
    if (!puedeSeguir) return;
    if (pantalla === "perfil") return setPantalla("instrucciones");
    if (pantalla === "instrucciones") return setPantalla("codigo");
    if (pantalla === "codigo") { setPaso(0); return setPantalla("galleta"); }
    if (pantalla === "galleta") {
      if (paso < PASOS_GALLETA.length - 1) return setPaso((p) => p + 1);
      setProbadas((ps) => [...ps, galleta]);
      return setPantalla("agua");
    }
    if (pantalla === "final") return enviar();
  };

  const atras = () => {
    if (pantalla === "perfil") return setPantalla("intro");
    if (pantalla === "instrucciones") return setPantalla("perfil");
    if (pantalla === "codigo") return setPantalla(probadas.length ? "agua" : "instrucciones");
    if (pantalla === "galleta") {
      if (paso > 0) return setPaso((p) => p - 1);
      return setPantalla("codigo");
    }
    if (pantalla === "final") return setPantalla("agua");
  };

  const otraGalleta = () => { setGalleta(GALLETA_VACIA); setPantalla("codigo"); };

  /* ---- Badge de sincronización (siempre visible) ---- */
  const badge = (
    <button
      type="button"
      className={`cata-sync cata-sync--${sync}`}
      onClick={sincronizar}
      title="Toca para sincronizar"
    >
      {sync === "ok" && <CheckCircle2 size={16} />}
      {sync === "syncing" && <Loader2 size={16} className="cata-spin" />}
      {sync === "pendiente" && <CloudUpload size={16} />}
      {sync === "error" && <CloudOff size={16} />}
      <span>
        {sync === "ok" && "En el Excel"}
        {sync === "syncing" && `Subiendo ${pendientes}...`}
        {sync === "pendiente" && `Por subir: ${pendientes}`}
        {sync === "error" && `Sin internet · ${pendientes} guardadas aquí`}
      </span>
    </button>
  );

  /* ============ PANTALLAS ============ */
  const renderPantalla = () => {
    /* ---------- INTRO ---------- */
    if (pantalla === "intro") {
      return (
        <div className="cata-intro">
          <div className="cata-intro-cookie">🍪</div>
          <p className="cata-eyebrow">Instituto CREAR · Laboratorio del sabor</p>
          <h1 className="cata-title">¡Eres catador oficial de galletas! 🕵️</h1>
          <p className="cata-text">
            Vas a probar galletas <b>secretas</b> rellenas de Nutella 🍫 y nos vas a ayudar
            a descubrir cuál es <b>la más deliciosa</b>.
          </p>
          <button className="cata-btn cata-btn--primary cata-btn--xl" onClick={() => setPantalla("perfil")}>
            ¡Empezar! <ChevronRight size={24} />
          </button>
        </div>
      );
    }

    /* ---------- PERFIL ---------- */
    if (pantalla === "perfil") {
      return (
        <div className="cata-card">
          <h2 className="cata-q-title">Cuéntanos de ti 🙋</h2>

          <label className="cata-label">Tu nombre (opcional)</label>
          <input
            className="cata-input"
            type="text"
            placeholder="Escribe tu nombre..."
            value={perfil.nombre}
            onChange={(e) => setP("nombre", e.target.value)}
          />

          <label className="cata-label">¿Cuántos años tienes?</label>
          <div className="cata-chips">
            {EDADES.map((n) => (
              <button key={n} className={`cata-chip ${perfil.edad === n ? "sel" : ""}`} onClick={() => setP("edad", n)}>
                {n}
              </button>
            ))}
          </div>

          <label className="cata-label">¿En qué curso estás?</label>
          <div className="cata-chips">
            {GRADOS.map((g) => (
              <button key={g} className={`cata-chip ${perfil.grado === g ? "sel" : ""}`} onClick={() => setP("grado", g)}>
                {g}
              </button>
            ))}
          </div>

          <label className="cata-label">¿Eres...?</label>
          <div className="cata-options">
            {GENEROS.map((g) => (
              <button
                key={g.valor}
                className={`cata-option ${perfil.genero === g.valor ? "sel" : ""}`}
                onClick={() => setP("genero", g.valor)}
              >
                <span className="cata-option-emoji">{g.emoji}</span>
                <span>{g.valor}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    /* ---------- INSTRUCCIONES ---------- */
    if (pantalla === "instrucciones") {
      return (
        <div className="cata-card">
          <h2 className="cata-q-title">Reglas del catador 📋</h2>
          <div className="cata-tips">
            <div className="cata-tip"><span>🔢</span><p>Cada galleta tiene un <b>número secreto</b> en su plato.</p></div>
            <div className="cata-tip"><span>🍪</span><p>Califica con <b>galletitas</b>: 1 es "no me gustó" y 5 es "¡me encantó!".</p></div>
            <div className="cata-tip"><span>💧</span><p>Toma un <b>sorbito de agua</b> entre galleta y galleta.</p></div>
            <div className="cata-tip"><span>🤫</span><p>No hay respuestas buenas ni malas, y no mires lo que responden tus amigos.</p></div>
          </div>
        </div>
      );
    }

    /* ---------- ELEGIR CÓDIGO ---------- */
    if (pantalla === "codigo") {
      return (
        <div className="cata-card">
          <p className="cata-eyebrow">Galleta #{probadas.length + 1}</p>
          <h2 className="cata-q-title">¿Qué número tiene tu plato? 🔍</h2>
          <p className="cata-ayuda">Busca el número secreto y tócalo</p>
          <div className="cata-tickets">
            {CODIGOS.map((c) => {
              const hecho = probadas.some((p) => p.codigo === c);
              return (
                <button
                  key={c}
                  disabled={hecho}
                  className={`cata-ticket ${galleta.codigo === c ? "sel" : ""} ${hecho ? "hecho" : ""}`}
                  onClick={() => setG("codigo", c)}
                >
                  <span className="cata-ticket-num">{c}</span>
                  {hecho && <span className="cata-ticket-check">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    /* ---------- EVALUAR GALLETA ---------- */
    if (pantalla === "galleta") {
      return (
        <div className={`cata-card cata-card--paso-${paso}`} key={paso}>
          <div className="cata-steps-head">
            <span className="cata-badge-codigo">Galleta #{probadas.length + 1} · 🔢 {galleta.codigo}</span>
            <div className="cata-dots">
              {PASOS_GALLETA.map((_, i) => (
                <span key={i} className={`cata-dot ${i < paso ? "done" : ""} ${i === paso ? "active" : ""}`} />
              ))}
            </div>
          </div>

          <div className="cata-paso-emoji">{pasoActual.emoji}</div>
          <h2 className="cata-q-title">{pasoActual.titulo}</h2>
          <p className="cata-ayuda">{pasoActual.ayuda}</p>

          {pasoActual.preguntas.map((p) => (
            <div key={p.campo} className="cata-pregunta">
              <p className="cata-pregunta-txt">{p.texto}</p>
              {p.tipo === "galletas" ? (
                <RatingGalletas valor={galleta[p.campo]} onChange={(v) => setG(p.campo, v)} grande={p.grande} />
              ) : (
                <Opciones valor={galleta[p.campo]} onChange={(v) => setG(p.campo, v)} opciones={p.opciones} />
              )}
            </div>
          ))}
        </div>
      );
    }

    /* ---------- AGUA / OTRA GALLETA ---------- */
    if (pantalla === "agua") {
      return (
        <div className="cata-card cata-agua">
          <div className="cata-gotas">💧🥤💧</div>
          <h2 className="cata-q-title">¡Galleta #{probadas.length} lista! 🎉</h2>
          <p className="cata-text">
            {puedeOtra
              ? "Toma un sorbito de agua para limpiar tu boquita antes de la siguiente."
              : "¡Ya probaste todas tus galletas! Vamos al final."}
          </p>
          <div className="cata-agua-btns">
            {puedeOtra && (
              <button className="cata-btn cata-btn--primary cata-btn--xl" onClick={otraGalleta}>
                🍪 Probar otra galleta
              </button>
            )}
            <button
              className={`cata-btn ${puedeOtra ? "cata-btn--soft" : "cata-btn--primary cata-btn--xl"}`}
              onClick={() => setPantalla("final")}
            >
              🏁 Terminar
            </button>
          </div>
        </div>
      );
    }

    /* ---------- FINAL ---------- */
    if (pantalla === "final") {
      return (
        <div className="cata-card">
          <h2 className="cata-q-title">¡Último paso! 🏆</h2>

          {probadas.length > 1 && (
            <>
              <label className="cata-label">¿Cuál fue tu galleta favorita?</label>
              <div className="cata-tickets">
                {probadas.map((g) => (
                  <button
                    key={g.codigo}
                    className={`cata-ticket cata-ticket--fav ${final.favorita === g.codigo ? "sel" : ""}`}
                    onClick={() => setFinal((f) => ({ ...f, favorita: g.codigo }))}
                  >
                    {final.favorita === g.codigo && <span className="cata-ticket-crown">👑</span>}
                    <span className="cata-ticket-num">{g.codigo}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="cata-label">¿Qué le cambiarías a nuestras galletas? (puedes elegir varias)</label>
          <div className="cata-chips cata-mejoras">
            {MEJORAS.map((m) => (
              <button
                key={m}
                className={`cata-chip ${final.mejoras.includes(m) ? "sel" : ""}`}
                onClick={() => toggleMejora(m)}
              >
                {m}
              </button>
            ))}
          </div>

          <label className="cata-label">¿Algo más que quieras contarnos? (opcional)</label>
          <textarea
            className="cata-textarea"
            rows={3}
            placeholder="Ej: le pondría más chocolate..."
            value={final.comentario}
            onChange={(e) => setFinal((f) => ({ ...f, comentario: e.target.value }))}
          />
        </div>
      );
    }

    /* ---------- GRACIAS ---------- */
    return (
      <div className="cata-done">
        <div className="cata-confetti" aria-hidden>
          {["🍪", "🍫", "⭐", "🎉", "✨", "🍪", "🎊", "🍫", "🌟", "🍪"].map((e, i) => (
            <span key={i} style={{ "--i": i }}>{e}</span>
          ))}
        </div>
        <div className="cata-done-card">
          <div className="cata-done-emoji">🏅</div>
          <h1 className="cata-title">¡Gracias, catador{perfil.nombre ? ` ${perfil.nombre.trim()}` : ""}!</h1>
          <p className="cata-text">Gracias a ti vamos a encontrar la galleta más deliciosa del cole 🍪</p>
          <button className="cata-btn cata-btn--primary cata-btn--xl" onClick={reiniciar}>
            <PartyPopper size={22} /> Siguiente catador
          </button>
        </div>
      </div>
    );
  };

  const mostrarNav = ["perfil", "instrucciones", "codigo", "galleta", "final"].includes(pantalla);
  const textoSiguiente =
    pantalla === "final" ? "¡Enviar!" :
    pantalla === "instrucciones" ? "¡Entendido!" :
    pantalla === "galleta" && paso === PASOS_GALLETA.length - 1 ? "¡Listo!" :
    "Siguiente";

  return (
    <div className="cata-app">
      <div className="cata-fondo" aria-hidden>
        {["🍪", "🍫", "✨", "🍪", "⭐", "🍫", "🍪", "✨"].map((e, i) => (
          <span key={i} style={{ "--i": i }}>{e}</span>
        ))}
      </div>

      {badge}

      <main className="cata-main">{renderPantalla()}</main>

      {mostrarNav && (
        <nav className="cata-nav">
          <button className="cata-btn cata-btn--ghost" onClick={atras}>
            <ChevronLeft size={20} /> Atrás
          </button>
          <button className="cata-btn cata-btn--primary" onClick={siguiente} disabled={!puedeSeguir}>
            {textoSiguiente}
            {pantalla === "final" ? <PartyPopper size={20} /> : <ChevronRight size={20} />}
          </button>
        </nav>
      )}
    </div>
  );
};