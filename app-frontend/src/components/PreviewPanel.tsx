import { useEditorStore } from '../store/editorStore';

export function PreviewPanel() {
  const { plainText } = useEditorStore();

  const normalizedText = plainText.replace(/\s+/g, ' ').trim();
  const wordCount = normalizedText ? normalizedText.split(/\s+/).length : 0;
  const charCount = normalizedText.length;

  return (
    <div className="h-16 p-2 bg-zinc-950 border border-white/[0.06] rounded-lg flex flex-col">
      <h3 className="text-[10px] font-semibold text-zinc-500 tracking-wide mb-1">Статистика документа</h3>
      
      <div className="grid grid-cols-2 gap-2 flex-1">
        <div className="flex flex-col justify-center">
          <span className="text-base font-light text-zinc-100 leading-none">{wordCount}</span>
          <span className="text-[10px] text-zinc-500 tracking-wide">Слова</span>
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-base font-light text-zinc-100 leading-none">{charCount}</span>
          <span className="text-[10px] text-zinc-500 tracking-wide">Символы</span>
        </div>
      </div>
    </div>
  );
}
