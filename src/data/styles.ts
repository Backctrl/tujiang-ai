// EXPORTS: IStyle, MOCK_STYLES
export interface IStyle {
  id: string
  name: string
  description: string
  category: 'home' | 'digital' | 'fashion' | 'beauty' | 'food'
  categoryLabel: string
  previewUrl: string
}

export const MOCK_STYLES: IStyle[] = [
  { id: '1', name: '北欧简约', description: '清新简洁的北欧风', category: 'home', categoryLabel: '家居家具', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvnci7cco_ve_miaoda' },
  { id: '2', name: '日式原木', description: '温暖自然日系风', category: 'home', categoryLabel: '家居家具', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvmm74qhq_ve_miaoda' },
  { id: '3', name: '现代轻奢', description: '精致高级轻奢感', category: 'home', categoryLabel: '家居家具', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvqbykodg_ve_miaoda' },
  { id: '4', name: '科技未来', description: '炫酷科技感风格', category: 'digital', categoryLabel: '3C数码', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvofxl2ag_ve_miaoda' },
  { id: '5', name: '极简黑白', description: '经典黑白极简风', category: 'digital', categoryLabel: '3C数码', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvrioc6do_ve_miaoda' },
  { id: '6', name: '赛博朋克', description: '霓虹赛博朋克风', category: 'digital', categoryLabel: '3C数码', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvnl7hgbq_ve_miaoda' },
  { id: '7', name: '杂志大片', description: '时尚杂志质感', category: 'fashion', categoryLabel: '服装服饰', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvngdjgfg_ve_miaoda' },
  { id: '8', name: '街头潮牌', description: '潮流街头风格', category: 'fashion', categoryLabel: '服装服饰', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvrsxyoeq_ve_miaoda' },
  { id: '9', name: '法式优雅', description: '浪漫法式优雅风', category: 'fashion', categoryLabel: '服装服饰', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvnmldsig_ve_miaoda' },
  { id: '10', name: '国潮新中式', description: '东方国潮美学', category: 'beauty', categoryLabel: '美妆护肤', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvm2itqlg_ve_miaoda' },
  { id: '11', name: '高级冷淡', description: '高级感冷调风格', category: 'beauty', categoryLabel: '美妆护肤', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvmynviei_ve_miaoda' },
  { id: '12', name: '少女梦幻', description: '甜美少女梦幻风', category: 'food', categoryLabel: '食品生鲜', previewUrl: '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvnzkxceq_ve_miaoda' },
]
