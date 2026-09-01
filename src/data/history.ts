// EXPORTS: IHistoryRecord, MOCK_HISTORY_RECORDS
export interface IHistoryRecord {
  id: string
  type: 'masterplan' | 'clone'
  typeLabel: string
  thumbnail: string
  creditsCost: number
  status: 'success' | 'failed' | 'processing'
  createdAt: string
  imageCount: number
}

const PROD_IMG_SOFA = '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvr4udyaq_ve_miaoda'
const PROD_IMG_EARPHONE = '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvo6o42ki_ve_miaoda'
const PROD_IMG_SKINCARE = '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvqchhiai_ve_miaoda'
const PROD_IMG_DRESS = '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvngo66ko_ve_miaoda'
const PROD_IMG_ROBOT = '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvnuvsocq_ve_miaoda'
const PROD_IMG_TABLE = '/spark/app/app_17d6s3g2evg/runtime/api/v1/storage/object/bucket_aadksvjffvedo_static/static%2Faadksvmhqaego_ve_miaoda'

export const PRODUCT_IMAGES = [
  PROD_IMG_SOFA,
  PROD_IMG_EARPHONE,
  PROD_IMG_SKINCARE,
  PROD_IMG_DRESS,
  PROD_IMG_ROBOT,
  PROD_IMG_TABLE,
]

export const MOCK_HISTORY_RECORDS: IHistoryRecord[] = [
  {
    id: '1',
    type: 'masterplan',
    typeLabel: 'AI主图详情全案',
    thumbnail: PROD_IMG_SOFA,
    creditsCost: 60,
    status: 'success',
    createdAt: '2024-01-15 14:30',
    imageCount: 9,
  },
  {
    id: '2',
    type: 'clone',
    typeLabel: 'AI克隆大师',
    thumbnail: PROD_IMG_EARPHONE,
    creditsCost: 40,
    status: 'success',
    createdAt: '2024-01-14 10:22',
    imageCount: 4,
  },
  {
    id: '3',
    type: 'masterplan',
    typeLabel: 'AI主图详情全案',
    thumbnail: PROD_IMG_SKINCARE,
    creditsCost: 80,
    status: 'processing',
    createdAt: '2024-01-15 15:10',
    imageCount: 12,
  },
]
