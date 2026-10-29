# Genera el icono de RYSA ERP (isotipo GR en 3D + título "RYSA ERP") y la imagen
# lateral del instalador a partir del isotipo de la marca.
#   recursos/icono.ico               16..256 px (desde 128 px lleva el título)
#   recursos/icono-256.png           vista previa / pantalla sin conexión
#   recursos/instalador-lateral.bmp  164x314, 24 bits (requisito de NSIS)
param(
    [string]$Fuente = (Join-Path $PSScriptRoot "..\..\rysa-vendedores\assets\images\icon.png"),
    [string]$Salida = (Join-Path $PSScriptRoot "..\recursos")
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;

public static class IconoRysa {
    static Color Grafito = Color.FromArgb(0x26, 0x27, 0x2b);
    static Color Rojo = Color.FromArgb(0xd7, 0x14, 0x1a);

    static byte[] Bytes(Bitmap b, out BitmapData d) {
        d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        var px = new byte[d.Stride * b.Height];
        Marshal.Copy(d.Scan0, px, 0, px.Length);
        return px;
    }
    static void Guardar(Bitmap b, BitmapData d, byte[] px) {
        Marshal.Copy(px, 0, d.Scan0, px.Length);
        b.UnlockBits(d);
    }

    // Quita el fondo blanco (con bordes suaves) y recorta al contorno del isotipo.
    public static Bitmap Isotipo(string ruta) {
        var src = new Bitmap(ruta);
        var b = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(b)) g.DrawImage(src, 0, 0, src.Width, src.Height);
        src.Dispose();
        BitmapData d; var px = Bytes(b, out d);
        int minX = b.Width, minY = b.Height, maxX = 0, maxY = 0;
        for (int y = 0; y < b.Height; y++) for (int x = 0; x < b.Width; x++) {
            int i = y * d.Stride + x * 4;
            int bl = px[i], gr = px[i + 1], rd = px[i + 2];
            double a = Math.Min(1.0, (255 - Math.Min(rd, Math.Min(gr, bl))) / 48.0);
            if (a < 0.02) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue; }
            Func<int, byte> sinBlanco = c => (byte)Math.Max(0, Math.Min(255, (c - (1 - a) * 255) / a));
            px[i] = sinBlanco(bl); px[i + 1] = sinBlanco(gr); px[i + 2] = sinBlanco(rd); px[i + 3] = (byte)(a * 255);
            if (a > 0.3) { minX = Math.Min(minX, x); maxX = Math.Max(maxX, x); minY = Math.Min(minY, y); maxY = Math.Max(maxY, y); }
        }
        Guardar(b, d, px);
        var r = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
        var rec = b.Clone(r, PixelFormat.Format32bppArgb);
        b.Dispose();
        return rec;
    }

    // Sombra: silueta del alfa, desenfocada (3 pasadas de caja ~ gaussiana).
    static Bitmap Sombra(Bitmap forma, int radio, int opacidad) {
        var b = new Bitmap(forma.Width, forma.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(b)) g.DrawImage(forma, 0, 0, forma.Width, forma.Height);
        BitmapData d; var px = Bytes(b, out d);
        int w = b.Width, h = b.Height;
        var a = new double[w * h];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) a[y * w + x] = px[y * d.Stride + x * 4 + 3];
        if (radio > 0) for (int p = 0; p < 3; p++) { a = Caja(a, w, h, radio, true); a = Caja(a, w, h, radio, false); }
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * d.Stride + x * 4;
            px[i] = px[i + 1] = px[i + 2] = 0x10;
            px[i + 3] = (byte)Math.Min(255, a[y * w + x] * opacidad / 255.0);
        }
        Guardar(b, d, px);
        return b;
    }
    static double[] Caja(double[] s, int w, int h, int r, bool horiz) {
        var o = new double[s.Length];
        int n = horiz ? w : h, m = horiz ? h : w;
        for (int j = 0; j < m; j++) {
            double suma = 0; int cuenta = 0;
            for (int k = -r; k < n + r; k++) {
                int entra = k + r, sale = k - r - 1;
                if (entra >= 0 && entra < n) { suma += s[horiz ? j * w + entra : entra * w + j]; cuenta++; }
                if (sale >= 0 && sale < n) { suma -= s[horiz ? j * w + sale : sale * w + j]; cuenta--; }
                if (k >= 0 && k < n) o[horiz ? j * w + k : k * w + j] = suma / (2 * r + 1);
            }
        }
        return o;
    }

    static GraphicsPath Redondeado(RectangleF r, float radio) {
        var p = new GraphicsPath(); float d = radio * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure(); return p;
    }

    static Graphics Lienzo(Bitmap b) {
        var g = Graphics.FromImage(b);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighQuality;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        return g;
    }

    // Isotipo con relieve: sombra proyectada y luego el logotipo (ya biselado).
    static void DibujarIsotipo(Graphics g, Bitmap iso, RectangleF caja, bool sombra) {
        float esc = Math.Min(caja.Width / iso.Width, caja.Height / iso.Height);
        float w = iso.Width * esc, h = iso.Height * esc;
        var dest = new RectangleF(caja.X + (caja.Width - w) / 2, caja.Y + (caja.Height - h) / 2, w, h);
        if (sombra) {
            int margen = Math.Max(2, (int)(w * 0.06));
            var forma = new Bitmap((int)w + margen * 2, (int)h + margen * 2, PixelFormat.Format32bppArgb);
            using (var gf = Lienzo(forma)) gf.DrawImage(iso, margen, margen, w, h);
            using (var s = Sombra(forma, Math.Max(1, (int)(w * 0.018)), 150))
                g.DrawImage(s, dest.X - margen, dest.Y - margen + h * 0.035f);
            forma.Dispose();
        }
        g.DrawImage(iso, dest);
    }

    public static Bitmap Icono(Bitmap iso, int t, bool titulo) {
        var b = new Bitmap(t, t, PixelFormat.Format32bppArgb);
        using (var g = Lienzo(b)) {
            bool chico = t < 48;
            float m = chico ? 0 : t * 0.055f;
            var placa = new RectangleF(m, m * 0.6f, t - 2 * m, t - 2 * m);
            float radio = placa.Width * 0.2f;
            // Sombra de la placa (da volumen sobre cualquier fondo de escritorio).
            if (!chico) {
                var forma = new Bitmap(t, t, PixelFormat.Format32bppArgb);
                using (var gf = Lienzo(forma)) using (var p = Redondeado(placa, radio)) gf.FillPath(Brushes.Black, p);
                using (var s = Sombra(forma, Math.Max(1, (int)(t * 0.02)), 110)) g.DrawImage(s, 0, t * 0.025f);
                forma.Dispose();
            }
            using (var p = Redondeado(placa, radio)) {
                using (var fondo = new LinearGradientBrush(placa, Color.FromArgb(0xff, 0xff, 0xff), Color.FromArgb(0xdc, 0xdd, 0xe1), 90f))
                    g.FillPath(fondo, p);
                // Bisel: luz arriba, borde oscuro abajo.
                using (var luz = new LinearGradientBrush(placa, Color.FromArgb(200, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90f))
                using (var pl = new Pen(luz, Math.Max(1f, t / 64f))) g.DrawPath(pl, p);
                using (var borde = new Pen(Color.FromArgb(90, 0x26, 0x27, 0x2b), Math.Max(1f, t / 128f))) g.DrawPath(borde, p);
            }
            float pad = placa.Width * (chico ? 0.08f : 0.13f);
            var area = RectangleF.Inflate(placa, -pad, -pad);
            if (titulo) {
                var arriba = new RectangleF(area.X, area.Y, area.Width, area.Height * 0.70f);
                DibujarIsotipo(g, iso, arriba, true);
                Titulo(g, new RectangleF(area.X, area.Y + area.Height * 0.74f, area.Width, area.Height * 0.26f), Grafito);
            } else {
                DibujarIsotipo(g, iso, area, t >= 32);
            }
        }
        return b;
    }

    // "RYSA" en grafito + "ERP" en rojo, ajustado al ancho disponible.
    static void Titulo(Graphics g, RectangleF r, Color colorRysa) {
        var familia = new FontFamily("Segoe UI");
        var estilo = FontStyle.Bold;
        float tam = r.Height * 0.9f;
        var fmt = StringFormat.GenericTypographic;
        SizeF a, e; Font f; float hueco;
        while (true) {
            f = new Font(familia, tam, estilo, GraphicsUnit.Pixel);
            a = g.MeasureString("RYSA", f, 10000, fmt); e = g.MeasureString("ERP", f, 10000, fmt);
            hueco = tam * 0.3f;
            if (a.Width + hueco + e.Width <= r.Width || tam < 4) break;
            f.Dispose(); tam *= 0.94f;
        }
        float x = r.X + (r.Width - a.Width - hueco - e.Width) / 2, y = r.Y + (r.Height - a.Height) / 2;
        using (var br = new SolidBrush(colorRysa)) g.DrawString("RYSA", f, br, x, y, fmt);
        using (var br = new SolidBrush(Rojo)) g.DrawString("ERP", f, br, x + a.Width + hueco, y, fmt);
        f.Dispose();
    }

    static void Dib(Bitmap b, Stream s) {
        int t = b.Width, mascara = ((t + 31) / 32) * 4 * t;
        var w = new BinaryWriter(s);
        w.Write(40); w.Write(t); w.Write(t * 2); w.Write((short)1); w.Write((short)32);
        w.Write(0); w.Write(t * t * 4 + mascara); w.Write(0); w.Write(0); w.Write(0); w.Write(0);
        BitmapData d; var px = Bytes(b, out d);
        for (int y = t - 1; y >= 0; y--) w.Write(px, y * d.Stride, t * 4);
        b.UnlockBits(d);
        w.Write(new byte[mascara]);
        w.Flush();
    }

    public static void Ico(Bitmap iso, int[] tamanos, string ruta) {
        var imagenes = new byte[tamanos.Length][];
        for (int i = 0; i < tamanos.Length; i++)
            using (var b = Icono(iso, tamanos[i], tamanos[i] >= 128))
            using (var ms = new MemoryStream()) {
                // 256 px en PNG; el resto como DIB de 32 bits (lo lee cualquier versión de Windows).
                if (tamanos[i] >= 256) b.Save(ms, ImageFormat.Png); else Dib(b, ms);
                imagenes[i] = ms.ToArray();
            }
        using (var w = new BinaryWriter(File.Create(ruta))) {
            w.Write((short)0); w.Write((short)1); w.Write((short)tamanos.Length);
            int off = 6 + 16 * tamanos.Length;
            for (int i = 0; i < tamanos.Length; i++) {
                byte lado = (byte)(tamanos[i] >= 256 ? 0 : tamanos[i]);
                w.Write(lado); w.Write(lado); w.Write((byte)0); w.Write((byte)0);
                w.Write((short)1); w.Write((short)32); w.Write(imagenes[i].Length); w.Write(off);
                off += imagenes[i].Length;
            }
            foreach (var im in imagenes) w.Write(im);
        }
    }

    // Imagen lateral del asistente de instalación (fondo grafito, isotipo y título).
    public static void Lateral(Bitmap iso, string ruta) {
        using (var b = new Bitmap(164, 314, PixelFormat.Format32bppArgb)) {
            using (var g = Lienzo(b)) {
                var r = new Rectangle(0, 0, 164, 314);
                using (var fondo = new LinearGradientBrush(r, Color.FromArgb(0x2e, 0x2f, 0x34), Color.FromArgb(0x16, 0x17, 0x1a), 90f))
                    g.FillRectangle(fondo, r);
                using (var franja = new SolidBrush(Rojo)) g.FillRectangle(franja, 0, 0, 164, 4);
                using (var icono = Icono(iso, 132, false)) g.DrawImage(icono, 16, 70);
                Titulo(g, new RectangleF(12, 210, 140, 30), Color.FromArgb(0xf2, 0xf2, 0xf3));
                using (var f = new Font("Segoe UI", 10f, GraphicsUnit.Pixel))
                using (var br = new SolidBrush(Color.FromArgb(0xa6, 0xa7, 0xab))) {
                    var fmt = new StringFormat { Alignment = StringAlignment.Center };
                    g.DrawString("Grupo RYSA", f, br, new RectangleF(0, 246, 164, 16), fmt);
                }
            }
            using (var b24 = b.Clone(new Rectangle(0, 0, 164, 314), PixelFormat.Format24bppRgb)) b24.Save(ruta, ImageFormat.Bmp);
        }
    }
}
"@

New-Item -ItemType Directory -Force $Salida | Out-Null
$iso = [IconoRysa]::Isotipo((Resolve-Path $Fuente).Path)
[IconoRysa]::Ico($iso, [int[]](16, 24, 32, 48, 64, 128, 256), (Join-Path $Salida "icono.ico"))
$vista = [IconoRysa]::Icono($iso, 256, $true)
$vista.Save((Join-Path $Salida "icono-256.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$vista.Dispose()
[IconoRysa]::Lateral($iso, (Join-Path $Salida "instalador-lateral.bmp"))
$iso.Dispose()
Write-Host "Iconos generados en $Salida"
