// EXPORTS: ITool, MOCK_TOOLS
export interface ITool {
  id: string
  name: string
  description: string
  icon: string
}

export const MOCK_TOOLS: ITool[] = [
  {
    id: '1',
    name: '智能抠图',
    description: 'AI自动识别主体，一键抠除背景',
    icon: 'Scissors',
  },
  {
    id: '2',
    name: '图片放大',
    description: '无损放大2-4倍，细节更清晰',
    icon: 'ZoomIn',
  },
  {
    id: '3',
    name: '背景替换',
    description: '智能替换产品背景，多种场景可选',
    icon: 'Image',
  },
  {
    id: '4',
    name: '图片修复',
    description: '修复瑕疵、去除水印和多余元素',
    icon: 'Wand2',
  },
]