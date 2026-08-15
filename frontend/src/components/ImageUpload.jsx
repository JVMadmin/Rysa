import { useRef, useState } from "react";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Link2, Loader2, ImageIcon, X } from "lucide-react";

// Componente reutilizable: sube imagen desde el dispositivo (object storage) o pega URL.
export function ImageUpload({ value, onChange, testid = "image-upload", heightClass = "h-40" }) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecciona una imagen válida"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/image", fd);
      onChange(fileUrl(data.url));
      toast.success("Imagen subida");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-2" data-testid={testid}>
      <div className={`relative ${heightClass} bg-slate-100 rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center`}>
        {value ? (
          <>
            <img src={fileUrl(value)} alt="preview" className="w-full h-full object-contain" data-testid={`${testid}-preview`} />
            <button type="button" onClick={() => onChange("")} className="absolute top-2 right-2 bg-white/90 rounded-full p-1 text-slate-500 hover:text-red-600 shadow" data-testid={`${testid}-clear`}>
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center text-slate-300"><ImageIcon className="w-8 h-8 mb-1" /><span className="text-xs">Sin imagen</span></div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current.click()} disabled={uploading} data-testid={`${testid}-btn`}>
          {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />} Subir del dispositivo
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowUrl((s) => !s)} data-testid={`${testid}-url-toggle`}>
          <Link2 className="w-4 h-4 mr-1" /> URL
        </Button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
      {showUrl && (
        <Input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="https://..." data-testid={`${testid}-url-input`} />
      )}
    </div>
  );
}

export default ImageUpload;
